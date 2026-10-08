import type { PoolClient } from 'pg';
import { pool } from '../../db';
import { renderDocument, type DocumentInput, type ItemRow } from './layout';
import { kampalaToday } from '../../lib/dates';
import { brand, mirror, type RenderedDocument } from './shared';

/**
 * Period and register reports (Phase 2b, plan §12).
 *
 * Statement: a customer's invoices and their paid split — the customer-facing
 * "what you owe us" view. Aging: every open invoice bucketed by age.
 * P&L: journal lines grouped by account type over a range — the money spine
 * from 008 finally paying off (income minus expense = profit). Asset
 * register: every asset with cost, accumulated depreciation and book value,
 * followed by the per-asset depreciation schedule.
 */

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '-' : Math.round(value).toLocaleString('en-US');

const dayText = (value: Date | string | null): string => (value ? String(value).slice(0, 10) : '-');

/** Statement + aging age in days, computed on Kampala day boundaries. */
const ageDays = (date: Date | string, today: string): number => {
  const then = dayText(date);
  return Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${then}T00:00:00Z`)) / 86_400_000));
};

export async function loadStatement(client: PoolClient, customerId: string): Promise<RenderedDocument | null> {
  const { rows } = await client.query<{ id: string; name: string; type: string; phone: string }>(
    `SELECT id, name, type, phone FROM customers WHERE id = $1`,
    [customerId],
  );
  if (!rows.length) return null;
  const customer = rows[0];

  const invoices = await client.query<{ number: string; date: Date; due: Date; total: number; paid: number; status: string }>(
    `SELECT number, date, due, total::float8 AS total, paid::float8 AS paid, status
     FROM invoices WHERE customer_id = $1 ORDER BY date, number`,
    [customerId],
  );

  const invoiceRows: ItemRow[] = invoices.rows.map((invoice) => ({
    cells: [invoice.number, dayText(invoice.date), dayText(invoice.due), invoice.status],
    amount: invoice.total - invoice.paid,
  }));

  const totalBilled = invoices.rows.reduce((sum, invoice) => sum + invoice.total, 0);
  const totalPaid = invoices.rows.reduce((sum, invoice) => sum + invoice.paid, 0);

  const input: DocumentInput = {
    title: 'CUSTOMER STATEMENT',
    reference: `STMT-${customer.id}-${kampalaToday()}`,
    brand,
    meta: [
      { label: 'Customer', value: customer.name },
      { label: 'Type', value: customer.type },
      { label: 'Phone', value: customer.phone || '-' },
      { label: 'Statement date', value: kampalaToday() },
      { label: 'Invoices', value: String(invoices.rows.length) },
      { label: 'Open balance', value: money(totalBilled - totalPaid) },
    ],
    sections: [
      {
        heading: 'Invoices',
        columns: ['Number', 'Date', 'Due', 'Status'],
        rows: invoiceRows,
      },
    ],
    totals: [
      { label: 'Total billed', value: money(totalBilled) },
      { label: 'Total paid', value: money(totalPaid) },
      { label: 'Balance due', value: money(totalBilled - totalPaid), emphasis: true },
    ],
    footerNote: 'This statement lists all invoices on file. Please quote the invoice numbers with your payment.',
  };
  const buffer = await renderDocument(input);
  const filename = `STMT-${customer.id}-${kampalaToday()}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

export async function loadAging(client: PoolClient): Promise<RenderedDocument> {
  const today = kampalaToday();
  const { rows } = await client.query<{ number: string; customer: string; date: Date; due: Date; total: number; paid: number; status: string }>(
    `SELECT i.number, c.name AS customer, i.date, i.due, i.total::float8 AS total, i.paid::float8 AS paid, i.status
     FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.status IN ('Unpaid', 'Partially Paid', 'Overdue')
     ORDER BY i.due, i.number`,
  );

  const bucket = (invoice: { due: Date; total: number; paid: number; number: string; customer: string }): ItemRow => {
    const age = ageDays(invoice.due, today);
    const bucketLabel = age <= 0 ? 'Current' : age <= 30 ? '1-30 days' : age <= 60 ? '31-60 days' : age <= 90 ? '61-90 days' : '90+ days';
    return {
      cells: [invoice.number, invoice.customer, dayText(invoice.due), bucketLabel],
      amount: invoice.total - invoice.paid,
    };
  };

  const rowsOut = rows.map(bucket);
  const totals = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  for (const invoice of rows) {
    const balance = invoice.total - invoice.paid;
    const age = ageDays(invoice.due, today);
    if (age <= 0) totals.current += balance;
    else if (age <= 30) totals.d30 += balance;
    else if (age <= 60) totals.d60 += balance;
    else if (age <= 90) totals.d90 += balance;
    else totals.d90plus += balance;
  }

  const input: DocumentInput = {
    title: 'ACCOUNTS RECEIVABLE AGING',
    reference: `AGING-${today}`,
    brand,
    meta: [
      { label: 'As of', value: today },
      { label: 'Open invoices', value: String(rows.length) },
      { label: 'Total receivable', value: money(rowsOut.reduce((sum, row) => sum + (row.amount ?? 0), 0)) },
    ],
    sections: [{ heading: 'Open invoices by due date', columns: ['Number', 'Customer', 'Due', 'Age bucket'], rows: rowsOut }],
    totals: [
      { label: 'Current', value: money(totals.current) },
      { label: '1-30 days', value: money(totals.d30) },
      { label: '31-60 days', value: money(totals.d60) },
      { label: '61-90 days', value: money(totals.d90) },
      { label: '90+ days', value: money(totals.d90plus), emphasis: true },
    ],
    footerNote: 'Buckets run on the invoice due date. Overdue balances deserve a call before they write themselves off.',
  };
  const buffer = await renderDocument(input);
  const filename = `AGING-${today}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

export async function loadProfitAndLoss(client: PoolClient, from: string, to: string): Promise<RenderedDocument> {
  // One row per account: debits land as expenses, credits as income.
  const { rows } = await client.query<{ code: string; name: string; type: string; debit: number; credit: number }>(
    `SELECT a.code, a.name, a.type,
            COALESCE(SUM(l.debit), 0)::float8 AS debit,
            COALESCE(SUM(l.credit), 0)::float8 AS credit
     FROM chart_of_accounts a
     JOIN journal_lines l ON l.account_code = a.code
     JOIN journal_entries e ON e.id = l.entry_id
     WHERE e.date >= $1 AND e.date <= $2 AND a.type IN ('income', 'expense')
     GROUP BY a.code, a.name, a.type
     ORDER BY a.code`,
    [from, to],
  );

  const income = rows.filter((row) => row.type === 'income');
  const expense = rows.filter((row) => row.type === 'expense');
  const totalIncome = income.reduce((sum, row) => sum + row.credit - row.debit, 0);
  const totalExpense = expense.reduce((sum, row) => sum + row.debit - row.credit, 0);

  const input: DocumentInput = {
    title: 'PROFIT AND LOSS',
    reference: `P&L ${from} to ${to}`,
    brand,
    meta: [
      { label: 'From', value: from },
      { label: 'To', value: to },
      { label: 'Generated', value: kampalaToday() },
    ],
    sections: [
      {
        heading: 'Income',
        columns: ['Account'],
        rows: (income.length ? income : [{ code: '-', name: 'No income postings in range', type: 'income', debit: 0, credit: 0 }]).map((row) => ({
          cells: [`${row.code} ${row.name}`],
          amount: row.credit - row.debit,
        })),
      },
      {
        heading: 'Expenses',
        columns: ['Account'],
        rows: (expense.length ? expense : [{ code: '-', name: 'No expense postings in range', type: 'expense', debit: 0, credit: 0 }]).map((row) => ({
          cells: [`${row.code} ${row.name}`],
          amount: row.debit - row.credit,
        })),
      },
    ],
    totals: [
      { label: 'Total income', value: money(totalIncome) },
      { label: 'Total expenses', value: money(totalExpense) },
      { label: 'Net profit', value: money(totalIncome - totalExpense), emphasis: true },
    ],
    footerNote: 'Drawn from the double-entry journal (008): income accounts by net credit, expense accounts by net debit.',
  };
  const buffer = await renderDocument(input);
  const filename = `PnL-${from}_${to}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

export async function loadAssetRegister(client: PoolClient): Promise<RenderedDocument> {
  const assets = await client.query<{
    id: string; name: string; serial_number: string; cost: number; salvage_value: number;
    useful_life_months: number | null; accumulated_depreciation: number; book_value: number;
    purchase_date: Date | null; disposed_at: Date | null; condition: string;
  }>(
    `SELECT id, name, serial_number, cost::float8 AS cost, salvage_value::float8 AS salvage_value,
            useful_life_months, accumulated_depreciation::float8 AS accumulated_depreciation,
            book_value::float8 AS book_value, purchase_date, disposed_at, condition
     FROM equipment ORDER BY id`,
  );

  const assetRows: ItemRow[] = assets.rows.map((asset) => ({
    cells: [
      asset.name,
      asset.serial_number,
      asset.purchase_date ? dayText(asset.purchase_date) : '-',
      asset.disposed_at ? 'Disposed' : asset.condition,
    ],
    amount: asset.book_value,
  }));

  const schedule: ItemRow[] = [];
  for (const asset of assets.rows) {
    const entries = await client.query<{ period: string; amount: number; accumulated: number; book_value: number }>(
      `SELECT period, amount::float8 AS amount, accumulated::float8 AS accumulated, book_value::float8 AS book_value
       FROM asset_depreciation_entries WHERE equipment_id = $1 ORDER BY period`,
      [asset.id],
    );
    for (const entry of entries.rows) {
      schedule.push({ cells: [asset.name, entry.period, money(entry.accumulated), money(entry.book_value)], amount: entry.amount });
    }
  }

  const input: DocumentInput = {
    title: 'ASSET REGISTER',
    reference: `ASSETS-${kampalaToday()}`,
    brand,
    meta: [
      { label: 'As of', value: kampalaToday() },
      { label: 'Assets', value: String(assets.rows.length) },
      { label: 'Total book value', value: money(assets.rows.reduce((sum, asset) => sum + asset.book_value, 0)) },
      { label: 'Total cost', value: money(assets.rows.reduce((sum, asset) => sum + asset.cost, 0)) },
    ],
    sections: [
      {
        heading: 'Register',
        columns: ['Asset', 'Serial', 'Purchased', 'Condition'],
        rows: assetRows,
      },
      ...(schedule.length
        ? [{
            heading: 'Depreciation schedule (posted entries)',
            columns: ['Asset', 'Period', 'Accumulated', 'Book value'],
            rows: schedule,
          }]
        : []),
    ],
    totals: [
      { label: 'Total accumulated depreciation', value: money(assets.rows.reduce((sum, asset) => sum + asset.accumulated_depreciation, 0)), emphasis: true },
    ],
    footerNote: 'Book value = cost − accumulated depreciation; the schedule (011) posts straight-line months per asset.',
  };
  const buffer = await renderDocument(input);
  const filename = `ASSETS-${kampalaToday()}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

export async function loadManifest(client: PoolClient, date: string): Promise<RenderedDocument | null> {
  // All orders ready or dispatched on `date` — sorted by number for the
  // collection driver's route sequence.
  const { rows } = await client.query<{
    number: string; customer_name: string; phone: string; items: string;
    total: number; weight_kg: number; pieces: number; status: string;
  }>(
    `SELECT lo.number, c.name AS customer_name, c.phone, lo.items,
            lo.total::float8 AS total, lo.weight_kg::float8 AS weight_kg, lo.pieces,
            lo.status
     FROM laundry_orders lo JOIN customers c ON c.id = lo.customer_id
     WHERE lo.status IN ('Ready', 'Dispatched') AND DATE(lo.ready_at) = $1
     ORDER BY lo.number`,
    [date],
  );

  const itemRows: ItemRow[] = rows.map((order) => ({
    cells: [
      order.number,
      order.customer_name,
      order.items || '-',
      `${order.weight_kg || 0}kg / ${order.pieces || 0} pcs`,
      order.status,
    ],
    amount: order.total,
  }));

  const totalValue = rows.reduce((sum, order) => sum + order.total, 0);

  const input: DocumentInput = {
    title: 'COLLECTION / DELIVERY MANIFEST',
    reference: `MANIFEST-${date}`,
    brand,
    meta: [
      { label: 'Date', value: date },
      { label: 'Orders', value: String(rows.length) },
      { label: 'Generated', value: kampalaToday() },
    ],
    sections: [
      {
        heading: `Orders ready for collection on ${date}`,
        columns: ['Number', 'Customer', 'Items', 'Weight / Pieces', 'Status'],
        rows: itemRows,
      },
    ],
    totals: [
      { label: 'Orders listed', value: String(rows.length) },
      { label: 'Total value', value: money(totalValue), emphasis: true },
    ],
    footerNote: 'This manifest lists all laundry orders ready or dispatched for the selected date.',
  };
  const buffer = await renderDocument(input);
  const filename = `MANIFEST-${date}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}

export async function loadBalanceSheet(client: PoolClient, from?: string, to?: string): Promise<RenderedDocument> {
  const today = kampalaToday();
  // Balance sheet is cumulative — every posting up to the "as of" date.
  const periodFrom = from || `${new Date().getFullYear()}-01-01`;
  const periodTo = to || today;

  // One row per account: net debit/credit totals from journal lines in range.
  const { rows } = await client.query<{
    code: string; name: string; type: string; debit: number; credit: number;
  }>(
    `SELECT a.code, a.name, a.type,
            COALESCE(SUM(l.debit), 0)::float8 AS debit,
            COALESCE(SUM(l.credit), 0)::float8 AS credit
     FROM chart_of_accounts a
     LEFT JOIN journal_lines l ON l.account_code = a.code
     LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.date >= $1 AND e.date <= $2
     WHERE a.active
     GROUP BY a.code, a.name, a.type
     ORDER BY a.type, a.code`,
    [periodFrom, periodTo],
  );

  // Normal balance: assets & expenses debit-side, the rest credit-side.
  const netBalance = (row: { type: string; debit: number; credit: number }): number => {
    switch (row.type) {
      case 'asset':
      case 'expense':
        return row.debit - row.credit;
      case 'liability':
      case 'equity':
      case 'income':
        return row.credit - row.debit;
      default:
        return row.debit - row.credit;
    }
  };

  const assets = rows.filter((r) => r.type === 'asset');
  const liabilities = rows.filter((r) => r.type === 'liability');
  const equityRows = rows.filter((r) => r.type === 'equity');
  const income = rows.filter((r) => r.type === 'income');
  const expenses = rows.filter((r) => r.type === 'expense');

  const totalAssets = assets.reduce((sum, r) => sum + netBalance(r), 0);
  const totalLiabilities = liabilities.reduce((sum, r) => sum + netBalance(r), 0);
  const totalEquity = equityRows.reduce((sum, r) => sum + netBalance(r), 0);
  const totalIncome = income.reduce((sum, r) => sum + netBalance(r), 0);
  const totalExpenses = expenses.reduce((sum, r) => sum + netBalance(r), 0);
  const netProfit = totalIncome - totalExpenses;

  const input: DocumentInput = {
    title: 'BALANCE SHEET',
    reference: `BALANCE-SHEET ${periodFrom} to ${periodTo}`,
    brand,
    meta: [
      { label: 'Period from', value: periodFrom },
      { label: 'As of', value: periodTo },
      { label: 'Generated', value: today },
    ],
    sections: [
      {
        heading: 'ASSETS',
        columns: ['Account', 'Type'],
        rows: assets.length
          ? assets.map((r) => ({ cells: [`${r.code} ${r.name}`, r.type], amount: netBalance(r) }))
          : [{ cells: ['No asset accounts with postings in range', ''], amount: 0 }],
      },
      {
        heading: 'LIABILITIES',
        columns: ['Account', 'Type'],
        rows: liabilities.length
          ? liabilities.map((r) => ({ cells: [`${r.code} ${r.name}`, r.type], amount: netBalance(r) }))
          : [{ cells: ['No liability accounts with postings in range', ''], amount: 0 }],
      },
      {
        heading: 'EQUITY',
        columns: ['Account', 'Type'],
        rows: [
          ...equityRows.map((r) => ({ cells: [`${r.code} ${r.name}`, r.type], amount: netBalance(r) })),
          { cells: ['Retained earnings (net profit)', ''], amount: netProfit },
        ],
      },
    ],
    totals: [
      { label: 'Total assets', value: money(totalAssets), emphasis: true },
      { label: 'Total liabilities', value: money(totalLiabilities) },
      { label: 'Total equity', value: money(totalEquity + netProfit) },
      { label: 'Net profit', value: money(netProfit), emphasis: true },
    ],
    footerNote: 'Drawn from the double-entry journal (008): assets by net debit, liabilities/equity by net credit. The accounting equation holds: assets = liabilities + equity.',
  };
  const buffer = await renderDocument(input);
  const filename = `BALANCE-SHEET-${periodTo}.pdf`;
  mirror(filename, buffer);
  return { buffer, filename };
}
