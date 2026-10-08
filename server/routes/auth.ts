import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, signTokens, verifyToken, type AuthUser } from '../middleware/auth';

export const authRouter = Router();

const fail = (res: import('express').Response, error: unknown, fallback: string) => {
  console.error('[auth]', error);
  res.status(500).json({ error: fallback });
};

/** POST /api/auth/login — identifier is an employee name or email. */
authRouter.post('/login', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { identifier?: unknown; email?: unknown; password?: unknown };
    const identifier = String(body.identifier ?? body.email ?? '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!identifier || !password) {
      res.status(422).json({ error: 'identifier and password are required' });
      return;
    }

    const { rows } = await pool.query(
      `SELECT id, name, role, app_scope, pin_hash, active FROM employees
       WHERE deleted_at IS NULL AND active
         AND (lower(name) = lower($1) OR (email <> '' AND lower(email) = lower($1)))
       LIMIT 1`,
      [identifier],
    );
    const employee = rows[0];
    if (!employee?.pin_hash || !(await bcrypt.compare(password, employee.pin_hash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user: AuthUser = { id: employee.id, name: employee.name, role: employee.role, app_scope: employee.app_scope ?? [] };
    res.json({ ...signTokens(user), user });
  } catch (error) {
    fail(res, error, 'Login failed');
  }
});

/** POST /api/auth/refresh — exchanges a refresh token for a fresh pair. */
authRouter.post('/refresh', async (req, res) => {
  try {
    const token = typeof (req.body ?? {}).refreshToken === 'string' ? req.body.refreshToken : '';
    const candidate = token ? verifyToken(token, 'refresh') : null;
    if (!candidate) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const { rows } = await pool.query(
      `SELECT id, name, role, app_scope, active FROM employees WHERE id = $1 AND deleted_at IS NULL`,
      [candidate.id],
    );
    const employee = rows[0];
    if (!employee?.active) {
      res.status(401).json({ error: 'Invalid refresh token' });
      return;
    }

    const user: AuthUser = { id: employee.id, name: employee.name, role: employee.role, app_scope: employee.app_scope ?? [] };
    res.json({ ...signTokens(user), user });
  } catch (error) {
    fail(res, error, 'Refresh failed');
  }
});

/** GET /api/auth/me — the signed-in employee, read fresh from the database. */
authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, role, app_scope, phone, email FROM employees
       WHERE id = $1 AND deleted_at IS NULL AND active`,
      [req.user?.id],
    );
    if (!rows[0]) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    res.json({ user: rows[0] });
  } catch (error) {
    fail(res, error, 'Lookup failed');
  }
});

/** POST /api/auth/logout — stateless tokens; the client discards its pair. */
authRouter.post('/logout', (_req, res) => {
  res.json({ ok: true });
});

const signUpSchema = z.object({
  inviteCode: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(30).default(''),
  password: z.string().min(6).max(100),
});

/**
 * POST /api/auth/sign-up — invite-code-gated new hire onboarding (public).
 *
 * The admin issues a single-use code (see routes/invites.ts) that carries the
 * role + app_scope to grant. A new hire submits the code with their own details
 * (name/email/password); the server creates the employee with EXACTLY the
 * code's grants, then marks the code used, then mints the JWT pair. The body
 * cannot escalate role or app_scope beyond the code — the code is the ceiling.
 * Backward compatible: /login (password against an existing pin_hash) is
 * untouched, so seeded/owner accounts keep working verbatim.
 */
authRouter.post('/sign-up', async (req, res) => {
  const parsed = signUpSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid sign-up payload', details: parsed.error.flatten() });
    return;
  }
  const { inviteCode, name, email, phone, password } = parsed.data;
  const code = (inviteCode ?? '').trim().toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Claim the code (single-use) under a row lock so concurrent sign-ups can't
    // double-spend the same invitation.
    const { rows } = await client.query(
      `SELECT role, app_scope FROM invitations
         WHERE code = $1
           AND used_at IS NULL
           AND revoked_at IS NULL
           AND expires_at > now()
       LIMIT 1 FOR UPDATE`,
      [code],
    );
    const invite = rows[0];
    if (!invite) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Invalid, expired, or already-used code' });
      return;
    }

    // The employee is created with EXACTLY the code's grants — the body cannot
    // escalate role or app_scope beyond what the admin authorised.
    const pinHash = await bcrypt.hash(password, 10);
    const { rows: created } = await client.query(
      `INSERT INTO employees (name, role, phone, email, hourly_rate, app_scope, pin_hash, active, created_by)
         VALUES ($1, $2, $3, $4, 0, $5, $6, TRUE, $7)
       RETURNING id, name, role, app_scope AS "appScope"`,
      [name, invite.role, phone ?? '', email ?? '', invite.app_scope, pinHash, `invite:${code}`],
    );
    const employee = created[0];

    await client.query(
      `UPDATE invitations SET used_by = $1, used_at = now() WHERE code = $2`,
      [employee.id, code],
    );

    await client.query('COMMIT');

    const user: AuthUser = {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      app_scope: employee.appScope ?? [],
    };
    res.status(201).json({ ...signTokens(user), user });
  } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
    fail(res, error, 'Sign-up failed');
  } finally {
    client.release();
  }
});

/**
 * GET /api/auth/invites/:code/validate — public pre-check for the Sign Up form.
 * Mounted on authRouter (before the staged guard) so an app can resolve a code
 * to its grants — role + app_scope + expiry — without presenting a token.
 */
authRouter.get('/invites/:code/validate', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT role, app_scope AS "appScope", expires_at AS "expiresAt"
       FROM invitations
       WHERE code = $1
         AND used_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > now()
       LIMIT 1`,
      [(req.params.code ?? '').trim().toUpperCase()],
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Invalid, expired, or already-used code' });
      return;
    }
    res.json({
      valid: true,
      role: rows[0].role,
      app_scope: rows[0].appScope,
      expires_at: rows[0].expiresAt,
    });
  } catch (error) {
    fail(res, error, 'Could not validate invite');
  }
});