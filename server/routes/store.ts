import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { parseBody } from '../validation/common';
import { placeholderId } from '../lib/tables';
import { dispatchEvent } from '../services/notifications';
import { publish } from '../services/realtime';

/**
 * Store operations (plan v5 Phase E). Reads come from /api/data; these are the
 * write paths the storekeeper UI needs:
 *   POST /api/store/movements            — receive/issue/adjust/return (+ qty delta on the item)
 *   PATCH /api/store/tools/:id           — check-out/in, condition, holder, job, due-back
 *   POST /api/store/purchase-requests    — raise a request (admin approves via PATCH)
 *   PATCH /api/store/purchase-requests/:id — approve/reject (admin) — SSE `purchase.approved`
 *   POST /api/store/utility-captures     — meter/slip capture (status Quarantined until posted)
 *   GET  /api/store/utility-captures     — capture list (optional ?status= filter)
 *   POST /api/store/utility-captures/:id/post — Admin one-click: quarantine → expense row
 * Movement qty updates run inside a transaction; utilities land Quarantined so
 * Admin posting to the ledger stays an explicit, auditable step.
 */

export const storeRouter = Router();

const MOVEMENT_TYPES = ['Received', 'Issued', 'Adjustment', 'Return'] as const;
const TOOL_STATUSES = ['In store', 'Checked out', 'Overdue', 'In repair'] as const;
const TOOL_CONDITIONS = ['Good', 'Fair', 'Needs repair'] as const;
const UTILITY_TYPES = ['Power', 'Water', 'Fuel', 'Transport', 'Maintenance'] as const;

const movementCreate = z.strictObject({
  itemId: z.string().min(1),
  type: z.enum(MOVEMENT_TYPES),
  qty: z.number().refine((v) => v !== 0, { message: 'qty must be non-zero' }),
  reference: z.string().trim().max(120).optional().default(''),
  movedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'movedOn must be YYYY-MM-DD').optional(),
  byName: z.string().trim().max(80).optional().default(''),
});

const toolPatch = z
  .strictObject({
    status: z.enum(TOOL_STATUSES).optional(),
    condition: z.enum(TOOL_CONDITIONS).optional(),
    holderName: z.string().trim().max(80).nullable().optional(),
    jobLabel: z.string().trim().max(120).nullable().optional(),
    dueBack: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

const purchaseRequestCreate = z.strictObject({
  itemId: z.string().min(1),
  description: z.string().trim().min(1).max(160),
  qty: z.number().positive(),
  supplierId: z.string().min(1).nullable().optional(),
  value: z.number().min(0),
});

const purchaseRequestPatch = z.strictObject({
  status: z.enum(['Approved', 'Rejected', 'Pending approval', 'Draft']),
  decidedBy: z.string().trim().max(80).optional().default(''),
});

const utilityCaptureCreate = z.strictObject({
  type: z.enum(UTILITY_TYPES),
  reference: z.string().trim().min(1).max(120),
  reading: z.string().trim().max(80).optional().default(''),
  amount: z.number().min(0),
  categoryKind: z.enum(['direct', 'operations']),
  capturedBy: z.string().trim().max(80).optional().default(''),
  capturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** POST /api/store/movements — movement row + inventory quantity delta, one tx. */
storeRouter.post('/movements', async (req: Request, res: Response) => {
  const input = parseBody(movementCreate, req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delta = input.type === 'Issued' ? -Math.abs(input.qty) : Math.abs(input.qty);
    const movementId = placeholderId('inventory_movements');
    const { rows } = await client.query(
      `INSERT INTO inventory_movements (id, item_id, type, qty, reference, moved_on, by_name)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7)
       RETURNING id, item_id AS "itemId", type, qty, reference, moved_on::text AS "movedOn", by_name AS "byName"`,
      [movementId, input.itemId, input.type, delta, input.reference, input.movedOn ?? null, input.byName],
    );
    const updated = await client.query(
      `UPDATE inventory_items SET quantity = quantity + $2 WHERE id = $1
       RETURNING quantity::float8 AS quantity`,
      [input.itemId, delta],
    );
    if (!updated.rows.length) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Inventory item not found' });
      return;
    }
    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], quantity: updated.rows[0].quantity });
    publish({ type: 'inventory-updated', by: req.user?.name });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    fail(res, error, 'Movement failed');
  } finally {
    client.release();
  }
});

/** PATCH /api/store/tools/:id — check-out/in and condition updates. */
storeRouter.patch('/tools/:id', async (req: Request, res: Response) => {
  const input = parseBody(toolPatch, req.body);
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 0;
  for (const [key, column] of Object.entries({
    status: 'status',
    condition: 'condition',
    holderName: 'holder_name',
    jobLabel: 'job_label',
    dueBack: 'due_back',
    notes: 'notes',
  })) {
    const value = input[key as keyof typeof input];
    if (value !== undefined) {
      i += 1;
      sets.push(`${column} = $${i}`);
      values.push(value === '' && column.endsWith('_name') || column === 'job_label' ? null : value);
    }
  }
  if (!sets.length) {
    res.status(422).json({ error: 'Nothing to update' });
    return;
  }
  try {
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE tool_checkouts SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, code, name, condition, status, holder_name AS "holderName",
                 job_label AS "jobLabel", due_back::text AS "dueBack", notes`,
      values,
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }
    res.json(rows[0]);
    publish({ type: 'store-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Tool update failed');
  }
});

/** POST /api/store/purchase-requests — the storekeeper raises; Admin decides. */
storeRouter.post('/purchase-requests', async (req: Request, res: Response) => {
  try {
    const input = parseBody(purchaseRequestCreate, req.body);
    // purchase_requests.id has no default — generate the same shape as the
    // seeded rows (e.g. "pr1") so a fresh insert satisfies the PK.
    const requestId = `pr${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { rows } = await pool.query(
      `INSERT INTO purchase_requests (id, item_id, description, qty, supplier_id, value, requested_by, requested_on, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, 'Pending approval')
       RETURNING id, item_id AS "itemId", description, qty, supplier_id AS "supplierId",
                 value, requested_by AS "requestedBy", requested_on::text AS "requestedOn", status`,
      [requestId, input.itemId, input.description, input.qty, input.supplierId ?? null, input.value, req.user?.name ?? ''],
    );
    res.status(201).json(rows[0]);
    publish({ type: 'purchase-created', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Purchase request failed');
  }
});

/** PATCH /api/store/purchase-requests/:id — approve/reject (admin console). */
storeRouter.patch('/purchase-requests/:id', async (req: Request, res: Response) => {
  try {
    const input = parseBody(purchaseRequestPatch, req.body);
    // `decided_by` is NOT NULL DEFAULT '' (migration 016). An absent/empty
    // decidedBy must collapse to '' rather than NULL, otherwise Postgres
    // rejects the row (SQLSTATE 23502 — "Approve modal does nothing" bug).
    // COALESCE(NULLIF(x,''),'') yields '' for NULL/empty, the real name otherwise.
    const { rows } = await pool.query(
      `UPDATE purchase_requests SET status = $2, decided_by = COALESCE(NULLIF($3, '') , ''), decided_on = CURRENT_DATE
       WHERE id = $1
       RETURNING id, status, decided_by AS "decidedBy", decided_on::text AS "decidedOn"`,
      [req.params.id, input.status, input.decidedBy],
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Purchase request not found' });
      return;
    }
    res.json(rows[0]);
    publish({ type: 'purchase-approved', by: req.user?.name, payload: rows[0] });
    // Only an approval rings the store's bell — rejections stay silent.
    // The response is already sent: a bell failure must never touch res.
    if (input.status === 'Approved') {
      const client = await pool.connect();
      try {
        await dispatchEvent(client, { type: 'purchase.approved', entityType: 'purchase_requests', entityId: String(rows[0].id) });
      } catch (bellError) {
        console.error('purchase.approved bell failed:', bellError);
      } finally {
        client.release();
      }
    }
  } catch (error) {
    fail(res, error, 'Purchase decision failed');
  }
});

/** GET /api/store/utility-captures — capture list, newest first (?status= filters). */
storeRouter.get('/utility-captures', async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const params: unknown[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, captured_on::text AS "capturedOn", type, reference, reading,
              amount::float8 AS amount, category_kind AS "categoryKind",
              captured_by AS "capturedBy", status, expense_id AS "expenseId"
       FROM utility_captures ${where}
       ORDER BY captured_on DESC, id DESC`,
      params,
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load utility captures');
  }
});

/** POST /api/store/utility-captures/:id/post — one-click quarantine → ledger. */
storeRouter.post('/utility-captures/:id/post', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the row so two admins cannot double-post the same slip.
    const capture = await client.query(
      `SELECT id, captured_on, type, reference, reading, amount, category_kind, status
       FROM utility_captures WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!capture.rows.length) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Utility capture not found' });
      return;
    }
    const row = capture.rows[0];
    if (row.status !== 'Quarantined') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: `Capture is ${row.status}, only Quarantined captures can be posted` });
      return;
    }
    // The expense mirrors the capture: category = utility type, division from
    // the capture's cost classification, date = the day it was captured.
    // expenses.id carries no default — generate the same shape createHandler does.
    const division = row.category_kind === 'direct' ? 'direct' : 'operations';
    const description = `${row.type} · ${row.reference}${row.reading ? ` (${row.reading})` : ''}`;
    const expenseId = `e${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await client.query(
      `INSERT INTO expenses (id, category, description, amount, date, division)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [expenseId, row.type, description, row.amount, row.captured_on, division],
    );
    await client.query(
      `UPDATE utility_captures SET status = 'Approved', expense_id = $2 WHERE id = $1`,
      [req.params.id, expenseId],
    );
    await client.query('COMMIT');
    res.status(201).json({ id: req.params.id, status: 'Approved', expenseId });
    // The ledger changed — every console listening refreshes.
    publish({ type: 'expense-created', by: req.user?.name, payload: { expenseId } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    fail(res, error, 'Posting utility capture failed');
  } finally {
    client.release();
  }
});

/** POST /api/store/utility-captures — lands Quarantined until Admin posts it. */
storeRouter.post('/utility-captures', async (req: Request, res: Response) => {
  try {
    const input = parseBody(utilityCaptureCreate, req.body);
    const { rows } = await pool.query(
      `INSERT INTO utility_captures (captured_on, type, reference, reading, amount, category_kind, captured_by, status)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, 'Quarantined')
       RETURNING id, captured_on::text AS "capturedOn", type, reference, reading,
                 amount, category_kind AS "categoryKind", captured_by AS "capturedBy", status`,
      [input.capturedOn ?? null, input.type, input.reference, input.reading, input.amount, input.categoryKind, input.capturedBy],
    );
    res.status(201).json(rows[0]);
    publish({ type: 'store-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Utility capture failed');
  }
});
