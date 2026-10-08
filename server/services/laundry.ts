import type { PoolClient } from 'pg';
import { pool } from '../db';
import { nextNumber } from './numbering';
import { kampalaToday } from '../lib/dates';

/**
 * Laundry logistics (Phase 1 data spine).
 *
 * createLaundryOrder prices an intake from its lines (amount = qty ×
 * unit_price, or an explicit amount per line) and claims an LDY number in
 * the same transaction — the payments/costing service pattern.
 *
 * updateLaundryStatus moves the fulfilment stage and derives the lifecycle
 * stamps server-side: reaching Ready stamps ready_at, reaching Collected
 * stamps collected_at. Stamps are never cleared by a later transition, so a
 * regression (Collected → Washing, say) keeps the history and the timeline
 * stays monotone. Money never touches status (payments service).
 */

const rounded = (value: number) => Math.round(value * 100) / 100;

export type LaundryLineInput = {
  serviceId?: string | null;
  description?: string;
  qty?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
};

export type LaundryIntakeInput = {
  customerId: string;
  promisedAt?: string | null;
  jobId?: string | null;
  weightKg?: number;
  pieces?: number;
  items?: string;
  lines?: LaundryLineInput[];
};

export type LaundryStatusResult = {
  id: string;
  status: string;
  readyAt: string | null;
  collectedAt: string | null;
};

/** Create a laundry order from an intake. Runs in its own transaction. */
export async function createLaundryOrder(
  input: LaundryIntakeInput,
): Promise<{ id: string; number: string; total: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createLaundryOrderInTx(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction body for an intake, composable like the other services. */
export async function createLaundryOrderInTx(
  client: PoolClient,
  input: LaundryIntakeInput,
): Promise<{ id: string; number: string; total: number }> {
  const lines = (input.lines ?? []).map((line) => ({
    serviceId: line.serviceId ?? null,
    description: line.description ?? '',
    qty: line.qty ?? 1,
    unit: line.unit ?? 'item',
    unitPrice: line.unitPrice ?? 0,
    amount: line.amount !== undefined ? rounded(line.amount) : rounded((line.qty ?? 1) * (line.unitPrice ?? 0)),
  }));
  const total = rounded(lines.reduce((sum, line) => sum + line.amount, 0));

  const number = await nextNumber(client, 'laundry');
  // Ids are minted in code like every other table (j…, pay…, jrnl…).
  const id = `ldy${Date.now()}`;
  await client.query(
    `INSERT INTO laundry_orders (id, number, customer_id, status, total, paid, items, received,
                                 promised_at, job_id, weight_kg, pieces)
     VALUES ($1, $2, $3, 'Received', $4, 0, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      number,
      input.customerId,
      total,
      input.items ?? '',
      kampalaToday(),
      input.promisedAt ?? null,
      input.jobId ?? null,
      input.weightKg ?? 0,
      input.pieces ?? 0,
    ],
  );
  for (const line of lines) {
    await client.query(
      `INSERT INTO laundry_order_items (order_id, service_id, description, qty, unit, unit_price, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, line.serviceId, line.description, line.qty, line.unit, line.unitPrice, line.amount],
    );
  }
  return { id, number, total };
}

/** Move a laundry order to a new fulfilment stage, stamping the timeline. Runs in its own transaction. */
export async function updateLaundryStatus(orderId: string, status: string): Promise<LaundryStatusResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await updateLaundryStatusInTx(client, orderId, status);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction body for a status change, composable like the other services. */
export async function updateLaundryStatusInTx(
  client: PoolClient,
  orderId: string,
  status: string,
): Promise<LaundryStatusResult> {
  const { rows } = await client.query<{ status: string; ready_at: string | null; collected_at: string | null }>(
    `SELECT status, ready_at::text AS ready_at, collected_at::text AS collected_at
     FROM laundry_orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  if (!rows.length) throw new Error('Laundry order not found');
  const order = rows[0];

  const today = kampalaToday();
  const readyAt = status === 'Ready' || status === 'Collected' ? (order.ready_at ?? today) : order.ready_at;
  const collectedAt = status === 'Collected' ? (order.collected_at ?? today) : order.collected_at;

  await client.query(`UPDATE laundry_orders SET status = $2, ready_at = $3, collected_at = $4 WHERE id = $1`, [
    orderId,
    status,
    readyAt,
    collectedAt,
  ]);
  return { id: orderId, status, readyAt, collectedAt };
}
