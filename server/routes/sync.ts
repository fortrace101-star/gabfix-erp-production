import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { parseBody } from '../validation/common';
import { nextNumber } from '../services/numbering';
import { publish } from '../services/realtime';

/**
 * Offline sync (multi-app-plan C1: laundry front office works offline-first).
 *
 *   GET  /api/sync/pull?since=<ISO> — server delta since the cursor (orders)
 *   POST /api/sync/push             — a batch of queued outbox ops, applied in
 *                                     order; per-op results so the client can
 *                                     ack exactly what landed and retry the rest
 *
 * Create ops claim a real LDY number from the same document_sequences the live
 * intake route uses; the client keeps its draft number but stores the server
 * number once the op is acknowledged.
 */
export const syncRouter = Router();

const pushOp = z.object({
  clientOpId: z.string().min(8).max(64),
  entity: z.enum(['laundry_order']),
  action: z.enum(['create', 'update_status']),
  payload: z.record(z.string(), z.unknown()),
});

const pushBody = z.object({
  ops: z.array(pushOp).min(1).max(50),
});

const createPayload = z.object({
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().min(4).max(24),
  service: z.string().trim().min(1).max(120),
  itemCount: z.number().int().positive(),
  amount: z.number().min(0),
  promisedAt: z.string().optional().nullable(),
  draftNumber: z.string().max(40).optional(),
});

const statusPayload = z.object({
  id: z.string().min(1),
  status: z.string().min(1).max(24),
});

/** Map the app's lowercase stage onto the server's fulfilment status enum. */
const STATUS_MAP: Record<string, string> = {
  received: 'Received',
  washing: 'Washing',
  drying: 'Drying',
  ready: 'Ready',
  collected: 'Collected',
};

syncRouter.get('/pull', async (req: Request, res: Response) => {
  const since = typeof req.query.since === 'string' ? req.query.since : '';
  const params: unknown[] = [];
  if (since) {
    const ts = new Date(since);
    if (Number.isNaN(ts.getTime())) {
      res.status(400).json({ error: 'since must be an ISO timestamp' });
      return;
    }
    params.push(ts.toISOString());
  }
  try {
    const orders = await pool.query(
      `SELECT id, number, customer_id AS "customerId", status, total::float8 AS total,
              pieces, promised_at::text AS "promisedAt", created_at::text AS "createdAt",
              updated_at::text AS "updatedAt"
       FROM laundry_orders
       ${since ? 'WHERE updated_at > $1::timestamptz' : ''}
       ORDER BY updated_at ASC
       LIMIT 500`,
      params,
    );
    res.json({ serverTime: new Date().toISOString(), orders: orders.rows });
  } catch (error) {
    fail(res, error, 'Sync pull failed');
  }
});

syncRouter.post('/push', async (req: Request, res: Response) => {
  const body = parseBody(pushBody, req.body);
  const client = await pool.connect();
  const results: Array<{ clientOpId: string; ok: boolean; id?: string; number?: string; error?: string }> = [];
  try {
    await client.query('BEGIN');
    for (const op of body.ops) {
      try {
        if (op.action === 'create') {
          const input = parseBody(createPayload, op.payload);
          // 1. Find or create the walk-in customer by phone.
          let customerId: string;
          const existing = await client.query(`SELECT id FROM customers WHERE phone = $1 LIMIT 1`, [input.customerPhone]);
          if (existing.rows.length) {
            customerId = existing.rows[0].id as string;
          } else {
            const created = await client.query(
              `INSERT INTO customers (id, name, company, type, phone, email, balance, status)
               VALUES ($1, $2, '', 'Residential', $3, '', 0, 'Active') RETURNING id`,
              [`c${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, input.customerName, input.customerPhone],
            );
            customerId = created.rows[0].id as string;
          }
          // 2. Claim the next LDY number (same sequence the live route uses).
          const number = await nextNumber(client, 'laundry');
          const orderId = `lo${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const promised = input.promisedAt ? new Date(input.promisedAt) : null;
          const items = `${input.service} · ${input.itemCount} items`;
          const receivedOn = new Date().toISOString().slice(0, 10);
          await client.query(
            `INSERT INTO laundry_orders (id, number, customer_id, status, total, items, received, pieces, promised_at)
             VALUES ($1, $2, $3, 'Received', $4, $5, $6::date, $7, $8)`,
            [orderId, number, customerId, input.amount, items, receivedOn, input.itemCount, promised && !Number.isNaN(promised.getTime()) ? promised.toISOString() : null],
          );
          results.push({ clientOpId: op.clientOpId, ok: true, id: orderId, number });
          continue;
        }

        if (op.action === 'update_status') {
          const input = parseBody(statusPayload, op.payload);
          const status = STATUS_MAP[input.status.toLowerCase()] ?? input.status;
          // Stamp the fulfilment timestamps server-side, like the live route.
          const stamps: Record<string, string> = {
            Ready: ', ready_at = now()',
            Collected: ', collected_at = now()',
          };
          const updated = await client.query(
            `UPDATE laundry_orders SET status = $2${stamps[status] ?? ''} WHERE id = $1 RETURNING number`,
            [input.id, status],
          );
          if (!updated.rows.length) {
            results.push({ clientOpId: op.clientOpId, ok: false, error: 'Order not found' });
            continue;
          }
          results.push({ clientOpId: op.clientOpId, ok: true });
          continue;
        }
      } catch (opError) {
        // One bad op must not sink the batch; report and move on.
        results.push({
          clientOpId: op.clientOpId,
          ok: false,
          error: opError instanceof Error ? opError.message : 'Rejected',
        });
      }
    }
    await client.query('COMMIT');
    res.json({ results });
    publish({ type: 'laundry-updated', by: req.user?.name });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    fail(res, error, 'Sync push failed');
  } finally {
    client.release();
  }
});
