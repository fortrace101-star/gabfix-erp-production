import type { PoolClient } from 'pg';
import { pool } from '../../db';
import { renderDocument, type DocumentInput, type ItemRow } from './layout';
import { brand, mirror, type RenderedDocument } from './shared';
import { kampalaToday } from '../../lib/dates';
import {
  loadAging,
  loadAssetRegister,
  loadBalanceSheet,
  loadManifest,
  loadProfitAndLoss,
  loadStatement,
} from './reports';

/**
 * Document registry (Phase 2, plan §12).
 *
 * Each type owns one loader that reads its rows and shapes the layout-kit
 * input; renderTypedDocument() renders the Buffer and mirrors it into
 * DOCUMENT_STORAGE_DIR so the messaging service can attach the same bytes
 * by URL later. Filenames are the document number (INV-00098.pdf), never a
 * browser-supplied string.
 */

export type DocumentType =
  | 'invoice'
  | 'receipt'
  | 'laundry'
  | 'job-card'
  | 'statement'
  | 'aging'
  | 'pl'
  | 'assets'
  | 'manifest'
  | 'delivery-note'
  | 'balance-sheet'
  | 'utility-slip';

export type { RenderedDocument };

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '-' : Math.round(value).toLocaleString('en-US');

const dayText = (value: Date | string | null): string => (value ? String(value).slice(0, 10) : '-');

// ── Loaders: one concern per type, all read-only ───────────────────────────

/**
 * Utility slip (plan v5 E5): the printable record for one captured meter
 * reading/slip. Quarantined captures print with a "not yet posted" note;
 * approved ones carry the ledger expense id they became.
 */
async function loadUtilitySlip(client: PoolClient, id: string): Promise<RenderedDocument | null> {
  const { rows } = await client.query<{
    id: string; captured_on: string; type: string; reference: string; reading: string | null;
    amount: number; category_kind: string; captured_by: string; status: string;
    expense_id: string | null; posted_on: string | null;
  }>(
    `SELECT id, captured_on::text AS captured_on, type, reference,
            COALESCE(reading, '') AS reading, amount::float8 AS amount,
            category_kind, captured_by, status,
            expense_id, updated_at::date::text AS posted_on
     FROM utility_captures WHERE id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const slip = rows[0];
  const input: DocumentInput = {
    title: 'UTILITY CAPTURE SLIP',
    reference: `UTC-${slip.id}`,
    brand,
    meta: [
      { label: 'Utility', value: slip.type },
      { label: 'Captured on', value: dayText(slip.captured_on) },
      { label: 'Reference / meter', value: slip.reference },
      { label: 'Reading', value: slip.reading || '-' },
      { label: 'Cost category', value: slip.category_kind },
      { label: 'Captured by', value: slip.captured_by || '-' },
    ],
    sections: [
      {
        heading: 'Capture detail',
        columns: ['Item', 'Value'],
        rows: [
          { cells: ['Status', slip.status] },
          { cells: ['Ledger expense', slip.expense_id ?? 'not posted yet'], amount: slip.amount },
        ],
      },
    ],
    totals: [{ label: 'Amount', value: money(slip.amount), emphasis: true }],
    footerNote:
      slip.status === 'Approved'
        ? `Posted to the ledger${slip.posted_on ? ` on ${slip.posted_on}` : ''} as expense ${slip.expense_id ?? '-'}.`
        : 'Quarantined: this slip is not yet in the ledger. Admin posts it from the Finance console.',
  };
  const buffer = await renderDocument(input);
  const filename = `UTC-${slip.id}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

async function loadInvoice(client: PoolClient, id: string): Promise<RenderedDocument | null> {
  const { rows } = await client.query<{
    id: string; number: string; date: Date; due: Date; total: number; paid: number; status: string;
    customer_name: string; customer_type: string; customer_phone: string;
  }>(
    `SELECT i.id, i.number, i.date, i.due, i.total::float8 AS total, i.paid::float8 AS paid, i.status,
            c.name AS customer_name, c.type AS customer_type, c.phone AS customer_phone
     FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const invoice = rows[0];

  const input: DocumentInput = {
    title: 'INVOICE',
    reference: invoice.number,
    brand,
    meta: [
      { label: 'Invoice number', value: invoice.number },
      { label: 'Invoice date', value: dayText(invoice.date) },
      { label: 'Due date', value: dayText(invoice.due) },
      { label: 'Customer', value: invoice.customer_name },
      { label: 'Type', value: invoice.customer_type },
      { label: 'Phone', value: invoice.customer_phone || '-' },
    ],
    sections: [
      {
        heading: 'Services billed',
        columns: ['Description'],
        rows: [
          // Invoices pre-date invoice_items (plan 005 adds that table with the
          // finance screens); until then the invoice total is one line.
          { cells: [`Services rendered — ${dayText(invoice.date)}`], amount: invoice.total },
          { cells: ['Payments received'], amount: -(invoice.paid || 0) },
        ],
      },
    ],
    totals: [
      { label: 'Total', value: money(invoice.total) },
      { label: 'Paid', value: money(invoice.paid) },
      { label: 'Balance due', value: money(invoice.total - invoice.paid), emphasis: true },
    ],
    footerNote: `Status: ${invoice.status}. Pay by the due date to avoid late fees. Thank you for your business.`,
  };
  const buffer = await renderDocument(input);
  const filename = `${invoice.number}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

async function loadReceipt(client: PoolClient, id: string): Promise<RenderedDocument | null> {
  const { rows } = await client.query<{
    id: string; number: string; direction: string; amount: number; currency: string; reference: string;
    received_at: Date; method: string | null; customer_name: string | null; invoice_number: string | null;
  }>(
    `SELECT p.id, p.number, p.direction, p.amount::float8 AS amount, p.currency, p.reference, p.received_at,
            m.name AS method, c.name AS customer_name, i.number AS invoice_number
     FROM payments p
     LEFT JOIN payment_methods m ON m.id = p.method_id
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id],
  );
  if (!rows.length) return null;
  const payment = rows[0];

  const input: DocumentInput = {
    title: 'PAYMENT RECEIPT',
    reference: payment.number,
    brand,
    meta: [
      { label: 'Receipt number', value: payment.number },
      { label: 'Received', value: dayText(payment.received_at) },
      { label: 'Method', value: payment.method ?? '-' },
      { label: 'Customer', value: payment.customer_name ?? '-' },
      { label: 'Reference', value: payment.reference || '-' },
      { label: 'Applied to', value: payment.invoice_number ?? '-' },
    ],
    sections: [
      {
        heading: 'Payment details',
        columns: ['Detail'],
        rows: [{ cells: [`${payment.direction === 'out' ? 'Refund/payout' : 'Payment received'} via ${payment.method ?? 'unspecified method'}`], amount: payment.amount }],
      },
    ],
    totals: [{ label: 'Amount', value: `${payment.currency} ${money(payment.amount)}`, emphasis: true }],
    footerNote: 'This receipt is proof of payment; please keep it for your records.',
  };
  const buffer = await renderDocument(input);
  const filename = `${payment.number}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

async function loadLaundryTicket(client: PoolClient, id: string): Promise<RenderedDocument | null> {
  const { rows } = await client.query<{
    id: string; number: string; status: string; total: number; paid: number; items: string;
    received: Date; promised_at: Date | null; ready_at: Date | null; collected_at: Date | null;
    weight_kg: number; pieces: number; customer_name: string; customer_phone: string;
  }>(
    `SELECT l.id, l.number, l.status, l.total::float8 AS total, l.paid::float8 AS paid, l.items,
            l.received, l.promised_at, l.ready_at, l.collected_at,
            l.weight_kg::float8 AS weight_kg, l.pieces,
            c.name AS customer_name, c.phone AS customer_phone
     FROM laundry_orders l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const order = rows[0];
  const items = await client.query<{ description: string; qty: number; unit: string; unit_price: number; amount: number }>(
    `SELECT description, qty::float8 AS qty, unit, unit_price::float8 AS unit_price, amount::float8 AS amount
     FROM laundry_order_items WHERE order_id = $1 ORDER BY id`,
    [id],
  );

  const itemRows: ItemRow[] = items.rows.length
    ? items.rows.map((item) => ({
        cells: [item.description || 'Laundry item', `${item.qty} ${item.unit} @ ${money(item.unit_price)}`],
        amount: item.amount,
      }))
    : [{ cells: [order.items || 'Laundry services'], amount: order.total }];

  const input: DocumentInput = {
    title: 'LAUNDRY TICKET',
    reference: order.number,
    brand,
    meta: [
      { label: 'Ticket number', value: order.number },
      { label: 'Received', value: dayText(order.received) },
      { label: 'Promised', value: dayText(order.promised_at) },
      { label: 'Customer', value: order.customer_name },
      { label: 'Phone', value: order.customer_phone || '-' },
      { label: 'Status', value: order.status },
    ],
    sections: [{ heading: 'Items', columns: ['Item', 'Quantity'], rows: itemRows }],
    totals: [
      ...(order.weight_kg ? [{ label: 'Weight', value: `${order.weight_kg} kg` }] : []),
      ...(order.pieces ? [{ label: 'Pieces', value: String(order.pieces) }] : []),
      { label: 'Total', value: money(order.total) },
      { label: 'Paid', value: money(order.paid) },
      { label: 'Balance', value: money(order.total - order.paid), emphasis: true },
    ],
    footerNote: `Ready ${dayText(order.ready_at)}${order.collected_at ? `, collected ${dayText(order.collected_at)}` : ''}. Keep this ticket for collection.`,
  };
  const buffer = await renderDocument(input);
  const filename = `${order.number}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

async function loadJobCard(client: PoolClient, id: string): Promise<RenderedDocument | null> {
  const { rows } = await client.query<{
    id: string; number: string; status: string; revenue: number; cost: number; date: Date;
    site_address: string | null; promised_at: Date | null; priority: string;
    customer_name: string; customer_phone: string; service_name: string;
  }>(
    `SELECT j.id, j.number, j.status, j.revenue::float8 AS revenue, j.cost::float8 AS cost, j.date,
            j.site_address, j.promised_at, j.priority,
            c.name AS customer_name, c.phone AS customer_phone, s.name AS service_name
     FROM jobs j JOIN customers c ON c.id = j.customer_id JOIN services s ON s.id = j.service_id
     WHERE j.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const job = rows[0];
  const assignments = await client.query<{ name: string; role: string }>(
    `SELECT e.name, a.role FROM job_assignments a JOIN employees e ON e.id = a.employee_id WHERE a.job_id = $1`,
    [id],
  );
  const costs = await client.query<{ description: string; category: string; qty: number; amount: number }>(
    `SELECT jc.description, COALESCE(cc.name, 'General') AS category, jc.qty::float8 AS qty, jc.amount::float8 AS amount
     FROM job_costs jc LEFT JOIN cost_categories cc ON cc.id = jc.category_id WHERE jc.job_id = $1 ORDER BY jc.id`,
    [id],
  );

  const costRows: ItemRow[] = costs.rows.length
    ? costs.rows.map((line) => ({ cells: [line.description || line.category, line.category], amount: line.amount }))
    : [{ cells: ['No cost lines recorded yet (legacy estimate)', ''], amount: job.cost }];

  const input: DocumentInput = {
    title: 'JOB CARD',
    reference: job.number,
    brand,
    meta: [
      { label: 'Job number', value: job.number },
      { label: 'Date', value: dayText(job.date) },
      { label: 'Status', value: `${job.status}${job.priority !== 'Normal' ? ` (${job.priority})` : ''}` },
      { label: 'Customer', value: job.customer_name },
      { label: 'Service', value: job.service_name },
      { label: 'Phone', value: job.customer_phone || '-' },
    ],
    sections: [
      {
        heading: 'Cost lines',
        columns: ['Description', 'Category'],
        rows: costRows,
      },
      {
        heading: 'Crew',
        columns: ['Name', 'Role'],
        rows: assignments.rows.length
          ? assignments.rows.map((person) => ({ cells: [person.name, person.role] }))
          : [{ cells: ['Unassigned', ''] }],
      },
    ],
    totals: [
      { label: 'Revenue', value: money(job.revenue) },
      { label: 'Cost', value: money(job.cost) },
      { label: 'Margin', value: money(job.revenue - job.cost), emphasis: true },
    ],
    footerNote: `${job.site_address ? `Site: ${job.site_address}. ` : ''}Promised ${dayText(job.promised_at)}.`,
  };
  const buffer = await renderDocument(input);
  const filename = `${job.number}.pdf`;
  mirror(filename, buffer);
    return { buffer, filename };
}

async function loadDeliveryNote(client: PoolClient, id: string): Promise<RenderedDocument | null> {
  const { rows } = await client.query<{
    id: string; number: string; status: string; total: number; paid: number;
    received: Date; items: string;
    weight_kg: number; pieces: number;
    customer_name: string; customer_phone: string;
    signature: string | null; received_by: string | null;
  }>(
        `SELECT l.id, l.number, l.status, l.total::float8 AS total, l.paid::float8 AS paid,
            l.received, l.items, l.weight_kg::float8 AS weight_kg, l.pieces,
            c.name AS customer_name, c.phone AS customer_phone,
            l.signature, l.received_by
     FROM laundry_orders l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1`,
    [id],
  );
  if (!rows.length) return null;
  const order = rows[0];
  const items = await client.query<{ description: string; qty: number; unit: string; unit_price: number; amount: number }>(
        `SELECT description, qty::float8 AS qty, unit, unit_price::float8 AS unit_price, amount::float8 AS amount
     FROM laundry_order_items WHERE order_id = $1 ORDER BY id`,
    [id],
  );

  const itemRows: ItemRow[] = items.rows.length
    ? items.rows.map((item) => ({
        cells: [item.description || 'Laundry item', `${item.qty} ${item.unit} @ ${money(item.unit_price)}`],
        amount: item.amount,
      }))
    : [{ cells: [order.items || 'Laundry services'], amount: order.total }];

  const input: DocumentInput = {
    title: 'DELIVERY NOTE',
    reference: order.number,
    brand,
    meta: [
      { label: 'Order number', value: order.number },
      { label: 'Date', value: dayText(order.received) },
      { label: 'Status', value: order.status },
      { label: 'Customer', value: order.customer_name },
      { label: 'Phone', value: order.customer_phone || '-' },
      { label: 'Received by', value: order.received_by || '—' },
    ],
    sections: [
      {
        heading: 'Items delivered',
        columns: ['Description', 'Qty / Unit'],
        rows: itemRows,
      },
    ],
    totals: [
      { label: 'Total', value: money(order.total) },
      { label: 'Paid', value: money(order.paid) },
      { label: 'Balance', value: money(order.total - order.paid), emphasis: true },
    ],
    footerNote: order.signature
      ? `Signature on file. Received by: ${order.received_by || '—'}.`
      : 'Signature: ________________   Received by: ________________',
  };
  const buffer = await renderDocument(input);
  const filename = `DELIVERY-${order.number}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

/**
 * Entity loaders take an id (invoice number, customer id, laundry order id,
 * or a date for manifest); range/register loaders ignore it (aging, assets)
 * or parse a from/to pair from it (pl, balance-sheet).
 * The route passes null for the no-id forms.
 */
const LOADERS: Record<DocumentType, (client: PoolClient, id: string | null) => Promise<RenderedDocument | null>> = {
  invoice: (client, id) => loadInvoice(client, id!),
  receipt: (client, id) => loadReceipt(client, id!),
  laundry: (client, id) => loadLaundryTicket(client, id!),
  'job-card': (client, id) => loadJobCard(client, id!),
  'delivery-note': (client, id) => loadDeliveryNote(client, id!),
  statement: (client, id) => loadStatement(client, id!),
  manifest: (client, id) => loadManifest(client, id!),
  aging: (client) => loadAging(client),
  assets: (client) => loadAssetRegister(client),
  pl: (client, id) => {
    // Optional "from/to" reference (2026-01-01/2026-09-27); defaults to YTD.
    const [from, to] = (id ?? '').split('/');
    const year = new Date().getFullYear();
    return loadProfitAndLoss(client, from || `${year}-01-01`, to || kampalaToday());
  },
  'balance-sheet': (client, id) => {
    // Optional "from/to" reference via ?from=&to= query; defaults to YTD.
    const [from, to] = (id ?? '').split('/');
    const year = new Date().getFullYear();
    return loadBalanceSheet(client, from || `${year}-01-01`, to || kampalaToday());
  },
  'utility-slip': (client, id) => loadUtilitySlip(client, id!),
};

/** Types that render without an entity id; the route rejects ids for them. */
export const ID_LESS_TYPES: DocumentType[] = ['aging', 'assets', 'pl', 'balance-sheet'];

export const DOCUMENT_TYPES = Object.keys(LOADERS) as DocumentType[];

/**
 * Render one document and mirror it; null when the id is unknown.
 * Pass a client to render inside a caller's transaction (tests, or a future
 * flow that must see uncommitted rows); otherwise a pool connection is used.
 * id may be null for the range/register documents (aging, assets, pl).
 */
export async function renderTypedDocument(
  type: DocumentType,
  id: string | null,
  client?: PoolClient,
): Promise<RenderedDocument | null> {
  const loader = LOADERS[type];
  if (!loader) throw new Error(`Unknown document type ${type}`);
  if (client) return loader(client, id);
  const own = await pool.connect();
  try {
    return await loader(own, id);
  } finally {
    own.release();
  }
}
