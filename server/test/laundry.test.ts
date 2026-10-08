import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../validation/common';
import { laundryIntakeCreate, laundryStatusPatch } from '../validation/laundry';
import { createLaundryOrderInTx, updateLaundryStatusInTx } from '../services/laundry';
import { pool } from '../db';
import { migrate } from '../migrate';

// ── Pure schema tests (no database) ────────────────────────────────────────

test('laundry intake requires a customer and rejects unknown fields', () => {
  assert.throws(() => parseBody(laundryIntakeCreate, { promisedAt: '2026-10-01' }));
  const parsed = parseBody(laundryIntakeCreate, {
    customerId: 'c1',
    promisedAt: '2026-10-01',
    weightKg: '12.5',
    pieces: '40',
    lines: [{ qty: '3', unitPrice: '15000' }],
  }) as { weightKg: number; pieces: number; lines: { qty: number; unitPrice: number }[] };
  assert.equal(parsed.weightKg, 12.5);
  assert.equal(parsed.pieces, 40);
  assert.equal(parsed.lines[0].qty, 3);
  assert.throws(() => parseBody(laundryIntakeCreate, { customerId: 'c1', urgent: true }));
});

test('laundry status patch only accepts fulfilment stages', () => {
  assert.equal(parseBody(laundryStatusPatch, { status: 'Ready' }).status, 'Ready');
  assert.throws(() => parseBody(laundryStatusPatch, { status: 'Teleported' }));
  // Lifecycle stamps are never client-writable.
  assert.throws(() => parseBody(laundryStatusPatch, { status: 'Ready', readyAt: '2026-10-01' }));
});

// ── Integration tests (real PostgreSQL; skipped when unreachable) ──────────

const dbUp = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false);

if (dbUp) {
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }

  test('laundry intake prices lines, claims LDY numbers and status moves stamp the timeline', { timeout: 20_000 }, async () => {
    const run = Date.now();
    const customerId = `ltest-c-${run}`;
    // Fresh client: the module-level one was released after migrate().
    const tx = await pool.connect();
    await tx.query('BEGIN');
    try {
      await tx.query(
        `INSERT INTO customers (id, name, phone, balance, status) VALUES ($1, 'Laundrytest', '', 0, 'Active')`,
        [customerId],
      );

      // Intake: 3 pieces at 15000 + an explicit 25000 pressing line.
      const created = await createLaundryOrderInTx(tx, {
        customerId,
        promisedAt: '2026-10-05',
        weightKg: 12.5,
        pieces: 40,
        lines: [
          { qty: 3, unitPrice: 15000 },
          { amount: 25000, description: 'Duvet pressing' },
        ],
      });
      assert.match(created.number, /^LDY-\d{5}$/);
      assert.equal(created.total, 70000);

      const row = await tx.query<{ status: string; total: number; weight_kg: number; pieces: number; promised_at: string }>(
        `SELECT status, total::float8 AS total, weight_kg::float8 AS weight_kg, pieces, promised_at::text AS promised_at
         FROM laundry_orders WHERE id = $1`,
        [created.id],
      );
      assert.equal(row.rows[0].status, 'Received');
      assert.equal(row.rows[0].total, 70000);
      assert.equal(row.rows[0].weight_kg, 12.5);
      assert.equal(row.rows[0].pieces, 40);
      assert.equal(row.rows[0].promised_at, '2026-10-05');

      const itemCount = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM laundry_order_items WHERE order_id = $1`,
        [created.id],
      );
      assert.equal(itemCount.rows[0].n, '2');

      // Received → Ready stamps ready_at; Ready → Collected stamps collected_at.
      const ready = await updateLaundryStatusInTx(tx, created.id, 'Ready');
      assert.equal(ready.status, 'Ready');
      assert.ok(ready.readyAt);
      assert.equal(ready.collectedAt, null);

      const collected = await updateLaundryStatusInTx(tx, created.id, 'Collected');
      assert.ok(collected.readyAt);
      assert.ok(collected.collectedAt);

      // A regression (Collected → Washing) keeps the history — stamps never clear.
      const back = await updateLaundryStatusInTx(tx, created.id, 'Washing');
      assert.ok(back.readyAt, 'ready_at survives a regression');
      assert.ok(back.collectedAt, 'collected_at survives a regression');

      // Unknown orders fail clearly.
      await assert.rejects(updateLaundryStatusInTx(tx, `lmissing-${run}`, 'Ready'), /not found/i);

      // Deleting the order cascades its item lines.
      await tx.query(`DELETE FROM laundry_orders WHERE id = $1`, [created.id]);
      const leftovers = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM laundry_order_items WHERE order_id = $1`,
        [created.id],
      );
      assert.equal(leftovers.rows[0].n, '0');

      await tx.query('ROLLBACK');
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  });
} else {
  test('laundry integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[laundry.test] PostgreSQL unreachable — integration tests skipped');
  });
}
