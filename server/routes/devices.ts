import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { parseBody } from '../validation/common';

/**
 * Devices registry (plan §6.3 / migration 003): the company phone numbers and
 * trackers issued to field staff that the /field beacon and the admin live map
 * identify by. The telemetry router already answers reads for its own joins;
 * this is the admin control-plane CRUD:
 *   GET    /api/devices        — registry with holder names
 *   POST   /api/devices        — register (msisdn unique)
 *   PATCH  /api/devices/:id    — reassign holder / rename / (de)activate
 *   DELETE /api/devices/:id    — soft delete (pings keep their device_id)
 */
export const devicesRouter = Router();

const deviceCreate = z.strictObject({
  msisdn: z.string().trim().min(4).max(24),
  label: z.string().trim().max(80).optional().default(''),
  type: z.enum(['phone', 'tracker']).optional().default('phone'),
  employeeId: z.string().trim().uuid().nullable().optional(),
});

const devicePatch = z
  .strictObject({
    label: z.string().trim().max(80).optional(),
    type: z.enum(['phone', 'tracker']).optional(),
    employeeId: z.string().trim().uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const DEVICE_SELECT = `
  SELECT d.id, d.msisdn, d.label, d.type, d.active,
         d.employee_id AS "employeeId", e.name AS "employeeName",
         d.installed_at::text AS "installedAt", d.created_at::text AS "createdAt"
  FROM devices d
  LEFT JOIN employees e ON e.id = d.employee_id`;

devicesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `${DEVICE_SELECT}
       WHERE d.deleted_at IS NULL
       ORDER BY d.created_at DESC`,
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load devices');
  }
});

devicesRouter.post('/', async (req: Request, res: Response) => {
  const input = parseBody(deviceCreate, req.body);
  try {
    const { rows } = await pool.query(
      `INSERT INTO devices (msisdn, label, type, employee_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [input.msisdn, input.label, input.type, input.employeeId ?? null, req.user?.name ?? ''],
    );
    const created = await pool.query(`${DEVICE_SELECT} WHERE d.id = $1`, [rows[0].id]);
    res.status(201).json(created.rows[0]);
  } catch (error) {
    fail(res, error, 'Device registration failed');
  }
});

devicesRouter.patch('/:id', async (req: Request, res: Response) => {
  const input = parseBody(devicePatch, req.body);
  const map: Record<string, string> = { label: 'label', type: 'type', employeeId: 'employee_id', active: 'active' };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(map)) {
    const value = input[key as keyof typeof input];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) {
    res.status(422).json({ error: 'Nothing to update' });
    return;
  }
  try {
    values.push(req.params.id);
    const updated = await pool.query(
      `UPDATE devices SET ${sets.join(', ')} WHERE id = $${values.length} AND deleted_at IS NULL RETURNING id`,
      values,
    );
    if (!updated.rows.length) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    const fresh = await pool.query(`${DEVICE_SELECT} WHERE d.id = $1`, [req.params.id]);
    res.json(fresh.rows[0]);
  } catch (error) {
    fail(res, error, 'Device update failed');
  }
});

devicesRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE devices SET deleted_at = now(), active = false WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    if (!rowCount) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    fail(res, error, 'Device delete failed');
  }
});
