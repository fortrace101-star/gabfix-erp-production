import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { guard, requireRole } from '../middleware/auth';

/**
 * Employees & access management (plan v5 B3) — the control-plane apex.
 * Owner/admin create staff accounts, set roles, grant/revoke app_scope, and
 * activate/deactivate accounts. Scope changes take effect at the employee's
 * next login (JWTs carry a snapshot; /auth/refresh re-reads the DB).
 */

export const employeesRouter = Router();

export const SCOPE_DOMAIN = ['admin', 'laundry', 'portal', 'store'] as const;
const APP_SCOPES = SCOPE_DOMAIN;
const ROLES = [
  'owner', 'manager', 'sales', 'technician', 'laundry', 'accountant', 'storekeeper', 'csr',
] as const;

const SCOPE_SUBSET = z
  .array(z.enum(APP_SCOPES))
  .max(4)
  .refine((arr) => new Set(arr).size === arr.length, { message: 'Duplicate app scopes' });

const createSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  role: z.enum(ROLES),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().max(120).optional().default(''),
  hourly_rate: z.coerce.number().min(0).optional().default(0),
  app_scope: SCOPE_SUBSET.optional().default(['portal']),
  password: z.string().min(6).max(100).optional(),
  active: z.boolean().optional().default(true),
});

const patchSchema = z.strictObject({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(120).optional(),
  hourly_rate: z.coerce.number().min(0).optional(),
  app_scope: SCOPE_SUBSET.optional(),
  password: z.string().min(6).max(100).optional(),
  active: z.boolean().optional(),
});

/** Only the owner may create/modify owner rows (single control-plane owner). */
function canTouch(actorRole: string, targetRole: string): boolean {
  if (actorRole === 'owner') return true;
  return actorRole === 'manager' && targetRole !== 'owner';
}

function actor(req: import('express').Request) {
  return { id: req.user!.id, role: req.user!.role };
}

/** GET /api/employees — staff list (no hashes). */
employeesRouter.get('/', requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, role, phone, email, hourly_rate::float8 AS "hourlyRate",
              app_scope AS "appScope", active, hired_on::text AS "hiredOn", created_at AS "createdAt"
       FROM employees WHERE deleted_at IS NULL ORDER BY active DESC, name`,
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load employees');
  }
});

/** POST /api/employees — create a staff account (optionally set the initial PIN). */
employeesRouter.post('/', guard('owner', 'manager'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid employee payload', details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  if (!canTouch(actor(req).role, body.role)) {
    res.status(403).json({ error: 'Only the owner can create owner accounts' });
    return;
  }
  try {
    const pinHash = body.password ? await bcrypt.hash(body.password, 10) : null;
    const { rows } = await pool.query(
      `INSERT INTO employees (name, role, phone, email, hourly_rate, app_scope, pin_hash, active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, role, phone, email, hourly_rate::float8 AS "hourlyRate",
                 app_scope AS "appScope", active`,
      [body.name, body.role, body.phone, body.email, body.hourly_rate, body.app_scope, pinHash, body.active, actor(req).id],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    fail(res, error, 'Could not create employee');
  }
});

/** PATCH /api/employees/:id — edit profile, grant/revoke scopes, deactivate. */
employeesRouter.patch('/:id', guard('owner', 'manager'), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid employee payload', details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, role, app_scope FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id],
    );
    const target = rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Employee not found' });
      return;
    }
    if (!canTouch(actor(req).role, target.role)) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Only the owner can modify owner accounts' });
      return;
    }
    if (body.role === 'owner' && target.role !== 'owner' && actor(req).role !== 'owner') {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Only the owner can promote to owner' }
      );
      return;
    }
    // Never let the last active owner be deactivated or demoted out of scope.
    if (target.role === 'owner' && (body.active === false || (body.role && body.role !== 'owner'))) {
      const { rows: owners } = await client.query(
        `SELECT COUNT(*)::int AS n FROM employees WHERE role = 'owner' AND active AND deleted_at IS NULL`,
      );
      if (owners[0].n <= 1) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: 'Cannot demote or deactivate the last active owner' });
        return;
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 0;
    for (const [key, column] of Object.entries({
      name: 'name',
      role: 'role',
      phone: 'phone',
      email: 'email',
      hourly_rate: 'hourly_rate',
      active: 'active',
    })) {
      if (body[key as keyof typeof body] !== undefined) {
        i += 1;
        sets.push(`${column} = $${i}`);
        values.push(body[key as keyof typeof body]);
      }
    }
    if (body.app_scope !== undefined) {
      i += 1;
      sets.push(`app_scope = $${i}`);
      values.push(body.app_scope);
    }
    if (body.password !== undefined) {
      i += 1;
      sets.push(`pin_hash = $${i}`);
      values.push(await bcrypt.hash(body.password, 10));
    }
    if (sets.length) {
      values.push(req.params.id);
      await client.query(
        `UPDATE employees SET ${sets.join(', ')} WHERE id = $${values.length}`,
        values,
      );
    }
    await client.query('COMMIT');

    const { rows: fresh } = await pool.query(
      `SELECT id, name, role, phone, email, hourly_rate::float8 AS "hourlyRate",
              app_scope AS "appScope", active, hired_on::text AS "hiredOn"
       FROM employees WHERE id = $1`,
      [req.params.id],
    );
    res.json(fresh[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    fail(res, error, 'Could not update employee');
  } finally {
    client.release();
  }
});

/** DELETE /api/employees/:id — soft delete (history keeps its references). */
employeesRouter.delete('/:id', guard('owner', 'manager'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT role FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id],
    );
    const target = rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Employee not found' });
      return;
    }
    if (!canTouch(actor(req).role, target.role)) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'Only the owner can delete owner accounts' });
      return;
    }
    if (target.role === 'owner') {
      const { rows: owners } = await client.query(
        `SELECT COUNT(*)::int AS n FROM employees WHERE role = 'owner' AND active AND deleted_at IS NULL`,
      );
      if (owners[0].n <= 1) {
        await client.query('ROLLBACK');
        res.status(422).json({ error: 'Cannot delete the last active owner' });
        return;
      }
    }
    await client.query(`UPDATE employees SET deleted_at = now(), active = FALSE WHERE id = $1`, [
      req.params.id,
    ]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    fail(res, error, 'Could not delete employee');
  } finally {
    client.release();
  }
});
