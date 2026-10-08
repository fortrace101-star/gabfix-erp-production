import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../validation/common';
import { paymentsResource } from '../validation/payments';
import { postJournalEntry } from '../services/ledger';
import { createPaymentInTx } from '../services/payments';
import { migrate } from '../migrate';
import { pool } from '../db';
import type { PoolClient } from 'pg';

// ── Pure schema tests (no database) ────────────────────────────────────────

test('payment create rejects zero and negative amounts', () => {
  assert.throws(() => parseBody(paymentsResource.create, { direction: 'in', amount: 0, customerId: 'c1', methodId: 'pm-cash' }));
  assert.throws(() => parseBody(paymentsResource.create, { direction: 'in', amount: -500, customerId: 'c1', methodId: 'pm-cash' }));
});

test('payment create accepts numeric strings and keeps direction/amount separate', () => {
  const parsed = parseBody(paymentsResource.create, { direction: 'out', amount: '12000', customerId: 'c1', methodId: 'pm-mtn' }) as { amount: number; direction: string };
  assert.equal(parsed.amount, 12000);
  assert.equal(parsed.direction, 'out');
});

test('payment create rejects unknown fields', () => {
  try {
    parseBody(paymentsResource.create, { direction: 'in', amount: 5, customerId: 'c1', methodId: 'pm-cash', branchId: 'b1' });
    assert.fail('expected branchId to be rejected');
  } catch (error) {
    assert.equal((error as { fields?: Record<string, string> }).fields?.branchId, 'Unknown field');
  }
});

test('postJournalEntry refuses unbalanced or single-line entries before any write', async () => {
  // The validator throws before the client is ever queried, so a null client
  // proves the invariant is enforced in code, not by the database.
  const client = null as unknown as PoolClient;
  await assert.rejects(
    postJournalEntry(client, { source: 'test', lines: [{ accountCode: '1000', debit: 100 }, { accountCode: '1100', credit: 90 }] }),
    /Unbalanced journal entry/,
  );
  await assert.rejects(
    postJournalEntry(client, { source: 'test', lines: [{ accountCode: '1000', debit: 100 }] }),
    /at least two non-zero lines/,
  );
});

// ── Integration tests (real PostgreSQL; skipped when it is unreachable) ────

const dbUp = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false);

if (dbUp) {
  // Migrations first: on a fresh dev/CI database this applies 001-008, so the
  // money tables and seeded payment methods exist before the tests run.
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }

  test('createPaymentInTx moves payment, journal, invoice and customer balance together', { timeout: 20_000 }, async () => {
    // Fixture ids unique per run so re-runs never collide with old rows.
    const run = Date.now();
    const customerId = `ptest-c-${run}`;
    const invoiceId = `ptest-i-${run}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO customers (id, name, phone, balance, status) VALUES ($1, 'Paytest', '', 0, 'Active')`,
        [customerId],
      );
      await client.query(
        `INSERT INTO invoices (id, number, customer_id, date, due, total, paid, status)
         VALUES ($1, $2, $3, '2026-08-01', '2026-08-15', 200000, 0, 'Unpaid')`,
        [invoiceId, `INV-PT-${run}`, customerId],
      );

      // First payment: 50k of 200k.
      const first = await createPaymentInTx(client, {
        direction: 'in',
        amount: 50000,
        customerId,
        methodId: 'pm-cash',
        invoiceId,
        reference: 'receipt 1',
      }, null);

      // PAY numbering from document_sequences.
      assert.match(first.number, /^PAY-\d{5}$/);
      assert.match(first.journal.number, /^JNL-\d{5}$/);

      // The journal entry is balanced with debit cash 1000 / credit AR 1100.
      const lines = await client.query<{ account_code: string; debit: number; credit: number }>(
        `SELECT account_code, debit::float8 AS debit, credit::float8 AS credit
         FROM journal_lines WHERE entry_id = $1 ORDER BY account_code`,
        [first.journal.id],
      );
      assert.deepEqual(
        lines.rows.map((row) => [row.account_code, row.debit, row.credit]),
        [
          ['1000', 50000, 0],
          ['1100', 0, 50000],
        ],
      );
      const debits = lines.rows.reduce((sum, row) => sum + row.debit, 0);
      const credits = lines.rows.reduce((sum, row) => sum + row.credit, 0);
      assert.equal(debits, credits);

      // Invoice moved to Partially Paid with paid = 50000; the journal entry
      // is linked back to the payment via source/source_id.
      const invoice = await client.query<{ paid: number; status: string }>(
        `SELECT paid::float8 AS paid, status FROM invoices WHERE id = $1`,
        [invoiceId],
      );
      assert.equal(invoice.rows[0].paid, 50000);
      assert.equal(invoice.rows[0].status, 'Partially Paid');
      const entry = await client.query<{ source: string; source_id: string }>(
        `SELECT source, source_id FROM journal_entries WHERE id = $1`,
        [first.journal.id],
      );
      assert.equal(entry.rows[0].source, 'payment');
      assert.equal(entry.rows[0].source_id, first.id);

      // Customer balance = invoice total - paid (nothing else for this customer).
      const customer = await client.query<{ balance: number }>(
        `SELECT balance::float8 AS balance FROM customers WHERE id = $1`,
        [customerId],
      );
      assert.equal(customer.rows[0].balance, 150000);

      // Second payment settles the rest via mobile money (float account 1010).
      const second = await createPaymentInTx(client, {
        direction: 'in',
        amount: 150000,
        customerId,
        methodId: 'pm-mtn',
        invoiceId,
      }, null);
      const settled = await client.query<{ paid: number; status: string; balance: number }>(
        `SELECT i.paid::float8 AS paid, i.status, c.balance::float8 AS balance
         FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
        [invoiceId],
      );
      assert.equal(settled.rows[0].paid, 200000);
      assert.equal(settled.rows[0].status, 'Paid');
      assert.equal(settled.rows[0].balance, 0);

      // The momo payment landed in the mobile money float, not cash.
      const momoLine = await client.query<{ account_code: string }>(
        `SELECT account_code FROM journal_lines WHERE entry_id = $1 AND debit > 0`,
        [second.journal.id],
      );
      assert.equal(momoLine.rows[0].account_code, '1010');

      // Roll back rather than commit: every assertion above already ran
      // inside the transaction, and the dev/CI database keeps no fixtures.
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  test('an unknown payment method rolls the whole transaction back', { timeout: 20_000 }, async () => {
    const run = Date.now();
    const customerId = `ptest-c-${run}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO customers (id, name, phone, balance, status) VALUES ($1, 'Paytest', '', 0, 'Active')`,
        [customerId],
      );
      await assert.rejects(
        createPaymentInTx(client, { direction: 'in', amount: 1000, customerId, methodId: 'pm-nonexistent' }, null),
        /Unknown payment method/,
      );
      await client.query('ROLLBACK');

      // Nothing leaked: no customer, no payment, no journal entry.
      const leftovers = await client.query<{ payments: string; entries: string }>(
        `SELECT
           (SELECT COUNT(*)::text FROM payments WHERE customer_id = $1) AS payments,
           (SELECT COUNT(*)::text FROM journal_entries WHERE memo LIKE '%PAY-%' AND source_id IN (SELECT id FROM payments WHERE customer_id = $1)) AS entries`,
        [customerId],
      );
      assert.equal(leftovers.rows[0].payments, '0');
      assert.equal(leftovers.rows[0].entries, '0');
      const gone = await client.query(`SELECT 1 FROM customers WHERE id = $1`, [customerId]);
      assert.equal(gone.rowCount, 0);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
} else {
  test('payments integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[payments.test] PostgreSQL unreachable — integration tests skipped');
  });
}
