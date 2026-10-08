import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { authEnforced, guard } from '../middleware/auth';

/** Staff & Access invite codes (plan v5 B3 extension) — admin-issued, single-use. */
export const invitesRouter = Router();

const SCOPE_DOMAIN = ['admin', 'laundry', 'portal', 'store'] as const;
const INVITE_ROLES = ['manager', 'sales', 'technician', 'laundry', 'accountant', 'storekeeper', 'csr'] as const;
const CODE_LENGTH = 8;
// No 0/O/1/I so codes stay readable when spoken or pasted on a mobile keyboard.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  return Array.from({ length: CODE_LENGTH }, () =>
    CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join('');
}

/** Normalise a user-typed code to the stored (upper-case) form. */
function normalise(code: string | string[] | undefined): string {
  const single = Array.isArray(code) ? code[0] : code;
  return (single ?? '').trim().toUpperCase();
}

const createSchema = z.strictObject({
  role: z.enum(INVITE_ROLES).default('technician'),
  app_scope: z.array(z.enum(SCOPE_DOMAIN)).min(1),
  expiresInHours: z.coerce.number().int().min(1).default(48),
});

/** POST /api/invites — issue a scoped, single-use invite code. */
invitesRouter.post('/', guard('owner', 'manager'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid invite payload', details: parsed.error.flatten() });
    return;
  }
  const { role, app_scope, expiresInHours } = parsed.data;

  // Managers can issue codes, but only the owner may grant admin-console access
  // (mirrors the owner-only wall on employees.ts). Staged: skipped until
  // AUTH_ENFORCE=true so the role check reflects a real authenticated actor.
  if (authEnforced() && app_scope.includes('admin') && req.user?.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner can grant admin-scope codes' });
    return;
  }

  const code = generateCode();
  try {
    const { rows } = await pool.query(
      `INSERT INTO invitations (code, role, app_scope, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5)
       RETURNING code, role, app_scope AS "appScope",
                  expires_at AS "expiresAt", created_at AS "createdAt"`,
      [
        code,
        role,
        app_scope,
        new Date(Date.now() + expiresInHours * 3_600_000),
        req.user?.name ?? 'admin',
      ],
    );
    res.status(201).json(rows[0]);
  } catch (error: unknown) {
    const pgCode = (error as { code?: string })?.code;
    if (pgCode === '23505') {
      // Pathological collision on the human-readable code (36^8 space) — retry.
      res.status(409).json({ error: 'Code collision, please retry' });
      return;
    }
    fail(res, error, 'Could not create invite');
  }
});

/** GET /api/invites — list codes (admin console Staff & Access view). */
invitesRouter.get('/', guard('owner', 'manager'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT code, role, app_scope AS "appScope",
              expires_at AS "expiresAt", created_at AS "createdAt",
              used_by AS "usedBy", used_at AS "usedAt", revoked_at AS "revokedAt"
       FROM invitations
       ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load invitations');
  }
});

/** PATCH /api/invites/:code/revoke — invalidate an unused code. */
invitesRouter.patch('/:code/revoke', guard('owner', 'manager'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE invitations
          SET revoked_at = now()
        WHERE code = $1 AND used_at IS NULL AND revoked_at IS NULL`,
      [normalise(req.params.code)],
    );
    if (!rowCount) {
      res.status(404).json({ error: 'Invite not found or not revocable' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'Could not revoke invite');
  }
});

/** DELETE /api/invites/:code — delete an unused code outright. */
invitesRouter.delete('/:code', guard('owner', 'manager'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM invitations WHERE code = $1 AND used_at IS NULL`,
      [normalise(req.params.code)],
    );
    if (!rowCount) {
      res.status(404).json({ error: 'Invite not found or already used' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'Could not delete invite');
  }
});

// Public code validation lives on authRouter (mounted before the staged guard)
// as GET /api/auth/invites/:code/validate, so apps can surface the Sign Up form
// without an access token.