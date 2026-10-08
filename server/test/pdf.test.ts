import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDocument } from '../services/pdf/layout';
import { DOCUMENT_TYPES, renderTypedDocument } from '../services/pdf/documents';
import { loadProfitAndLoss, loadBalanceSheet, loadManifest } from '../services/pdf/reports';
import { pool } from '../db';
import { migrate } from '../migrate';

// ── Pure rendering tests (no database) ─────────────────────────────────────

test('layout kit renders a valid single-page PDF with header, table and totals', async () => {
  const buffer = await renderDocument({
    title: 'INVOICE',
    reference: 'INV-TEST-1',
    brand: { name: 'Gabfix', tagline: 'Cleaning and laundry', phone: '+256 700 000 000' },
    meta: [
      { label: 'Number', value: 'INV-TEST-1' },
      { label: 'Date', value: '2026-09-27' },
      { label: 'Customer', value: 'Kampala Guesthouse' },
    ],
    sections: [{ heading: 'Services', columns: ['Description'], rows: [{ cells: ['Deep clean'], amount: 250000 }] }],
    totals: [
      { label: 'Total', value: '250,000' },
      { label: 'Balance due', value: '250,000', emphasis: true },
    ],
    footerNote: 'Thank you.',
  });

  assert.ok(buffer.subarray(0, 5).toString() === '%PDF-', 'starts with %PDF-');
  assert.ok(buffer.includes(Buffer.from('/Type /Page')), 'has a page object');
  assert.ok(buffer.toString('latin1').trimEnd().endsWith('%%EOF'), 'ends with %%EOF');
});

test('layout sanitizes non-WinAnsi glyphs instead of throwing', async () => {
  const buffer = await renderDocument({
    title: 'LAUNDRY TICKET',
    reference: 'LDY-00216',
    sections: [{ columns: ['Item'], rows: [{ cells: ['Wash items'], amount: 0 }] }],
  });
  assert.ok(buffer.length > 1000);
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

  test('document loaders shape seeded rows into all registered types', { timeout: 20_000 }, async () => {
    const run = Date.now();
    const customerId = `pdftest-c-${run}`;
    const invoiceId = `pdftest-i-${run}`;
    const jobId = `pdftest-j-${run}`;
    const laundryId = `pdftest-l-${run}`;
    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      await tx.query(
        `INSERT INTO customers (id, name, phone, balance, status) VALUES ($1, 'PDF Test Ltd', '+256 777 000 111', 0, 'Active')`,
        [customerId],
      );
      await tx.query(
        `INSERT INTO invoices (id, number, customer_id, date, due, total, paid, status)
         VALUES ($1, $2, $3, '2026-09-01', '2026-09-15', 150000, 50000, 'Partially Paid')`,
        [invoiceId, `INV-PDF-${run}`, customerId],
      );
      await tx.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, revenue, cost)
         VALUES ($1, $2, $3, 's1', '2026-09-02', 'Completed', 300000, 120000)`,
        [jobId, `JOB-PDF-${run}`, customerId],
      );
      await tx.query(
        `INSERT INTO laundry_orders (id, number, customer_id, status, total, paid, items, received, ready_at, weight_kg, pieces, signature, received_by)
         VALUES ($1, $2, $3, 'Ready', 80000, 0, '7kg wash', '2026-09-03', '2026-09-03', 7, 10, NULL, NULL)`,
        [laundryId, `LDY-PDF-${run}`, customerId],
      );
      await tx.query(
        `INSERT INTO laundry_order_items (order_id, description, qty, unit, unit_price, amount)
         VALUES ($1, 'Wash and fold', 7, 'kg', 10000, 70000)`,
        [laundryId],
      );

      // Seeded payment pm-cash comes from 008_money.sql.
      const payment = await tx.query<{ id: string }>(
        `INSERT INTO payments (id, number, direction, customer_id, method_id, amount, currency, reference, invoice_id, status, received_at)
         VALUES ($1, $2, 'in', $3, 'pm-cash', 50000, 'UGX', 'receipt 1', $4, 'confirmed', '2026-09-05T12:00:00Z')
         RETURNING id`,
        [`pdftest-pay-${run}`, `PAY-PDF-${run}`, customerId, invoiceId],
      );

      // Utility capture for the utility-slip loader (plan v5 E5).
      // utility_captures.id has no default — generate the same shape the route does.
      const captureId = `uc${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await tx.query(
        `INSERT INTO utility_captures (id, captured_on, type, reference, reading, amount, category_kind, captured_by, status)
         VALUES ($1, '2026-09-04', 'Power', 'meter 12', '1402 kWh', 95000, 'operations', 'pdf-test', 'Quarantined')`,
        [captureId],
      );

      for (const type of DOCUMENT_TYPES) {
        const id =
          type === 'invoice' ? invoiceId
          : type === 'receipt' ? payment.rows[0].id
          : type === 'laundry' ? laundryId
          : type === 'job-card' ? jobId
          : type === 'delivery-note' ? laundryId
          : type === 'statement' ? customerId
          : type === 'manifest' ? '2026-09-03'
          : type === 'pl' ? '2026-01-01/2026-12-31'
          : type === 'utility-slip' ? captureId
          : null;
        const rendered = await renderTypedDocument(type, id, tx);
        assert.ok(rendered, `${type} renders`);
        assert.ok(rendered!.buffer.subarray(0, 5).toString() === '%PDF-', `${type} is a PDF`);
        assert.match(rendered!.filename, /\.pdf$/, `${type} filename ends .pdf`);
      }

      // Range/register reports ignore the fixture ids entirely.
      for (const type of ['aging', 'assets', 'balance-sheet'] as const) {
        const rendered = await renderTypedDocument(type, null, tx);
        assert.ok(rendered, `${type} renders without an id`);
        assert.ok(rendered!.buffer.subarray(0, 5).toString() === '%PDF-', `${type} is a PDF`);
      }
      const pnl = await loadProfitAndLoss(tx, '2026-01-01', '2026-12-31');
      assert.ok(pnl.buffer.subarray(0, 5).toString() === '%PDF-', 'P&L is a PDF');
      const bs = await loadBalanceSheet(tx, '2026-01-01', '2026-12-31');
      assert.ok(bs.buffer.subarray(0, 5).toString() === '%PDF-', 'balance sheet is a PDF');
      const manifest = await loadManifest(tx, '2026-09-03');
      assert.ok(manifest, 'manifest renders');
      assert.ok(manifest!.buffer.subarray(0, 5).toString() === '%PDF-', 'manifest is a PDF');
      const statement = await renderTypedDocument('statement', customerId, tx);
      assert.ok(statement, 'statement renders');
      assert.match(statement!.filename, /^STMT-/, 'statement filename carries the customer id');

      // Unknown ids return null.
      const missing = await renderTypedDocument('invoice', `pdftest-none-${run}`, tx);
      assert.equal(missing, null);

      await tx.query('ROLLBACK');
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  });
} else {
  test('pdf integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[pdf.test] PostgreSQL unreachable — integration tests skipped');
  });
}
