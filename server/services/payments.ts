import type { PoolClient } from 'pg';
import { pool } from '../db';
import { insertRecord } from '../repositories/records';
import { paymentsResource } from '../validation/payments';
import type { PaymentCreate } from '../validation/payments';
import { nextNumber } from './numbering';
import { postJournalEntry } from './ledger';
import { kampalaToday } from '../lib/dates';

/**
 * Payment capture (Phase 1 data spine).
 *
 * One transaction records the payment, claims its PAY number, posts the
 * balanced journal entry and recomputes every balance the plan's exit
 * criteria name — invoice paid + status, customer balance — so "a recorded
 * payment moves invoice status, customer balance, journal and cash flow
 * together" is guaranteed by the commit itself, not by follow-up work.
 *
 * Balance semantics: `paid` on the document sums counted payments
 * (confirmed/reconciled, not voided or deleted); customer balance is the
 * receivable across invoices and laundry orders. Laundry `status` is a
 * fulfilment stage (Washing/Ready/...) and is deliberately never touched by
 * money. The journal posts direction-in as debit cash/momo/bank, credit AR;
 * direction-out (money paid out) flips it through accounts payable.
 */

/** Payment statuses that move document and customer balances. */
const COUNTED = `status IN ('confirmed', 'reconciled') AND deleted_at IS NULL`;
/** Signed contribution to a document's `paid`: money in adds, refunds subtract. */
const SIGNED = () => `SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END)`;

/** Accounts receivable / payable codes from the chart_of_accounts seed. */
const AR = '1100';
const AP = '2000';

export type CreatePaymentResult = {
  id: string;
  number: string;
  journal: { id: string; number: string };
};

/** Record a payment in its own transaction (the route-level entry point). */
export async function createPayment(input: PaymentCreate, recordedBy: string | null): Promise<CreatePaymentResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await createPaymentInTx(client, input, recordedBy);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction body, separated so tests and future routes can compose it. */
export async function createPaymentInTx(
  client: PoolClient,
  input: PaymentCreate,
  recordedBy: string | null,
): Promise<CreatePaymentResult> {
  const day = input.date ?? kampalaToday();

  // The method decides where the money lands (cash 1000, momo float 1010,
  // bank 1020); the migration seeds those links for the shipped methods.
  const method = await client.query<{ gl_account_code: string | null }>(
    `SELECT gl_account_code FROM payment_methods WHERE id = $1`,
    [input.methodId],
  );
  if (!method.rows.length) throw new Error('Unknown payment method');
  const cashAccount = method.rows[0].gl_account_code ?? '1000';

  // Resolve the settled document, if any, and pin it to the payer.
  if (input.invoiceId) await expectCustomerDocument(client, 'invoices', 'Invoice', input.invoiceId, input.customerId);
  if (input.laundryOrderId) await expectCustomerDocument(client, 'laundry_orders', 'Laundry order', input.laundryOrderId, input.customerId);
  if (input.jobId) await expectCustomerDocument(client, 'jobs', 'Job', input.jobId, input.customerId);

  const number = await nextNumber(client, 'payment');
  const id = `pay${Date.now()}`;
  await insertRecord(paymentsResource, {
    number,
    direction: input.direction,
    customerId: input.customerId,
    methodId: input.methodId,
    amount: input.amount,
    currency: input.currency ?? 'UGX',
    reference: input.reference ?? '',
    invoiceId: input.invoiceId ?? null,
    laundryOrderId: input.laundryOrderId ?? null,
    jobId: input.jobId ?? null,
    status: input.status ?? 'confirmed',
    recordedBy: recordedBy ?? null,
    receivedAt: `${day}T12:00:00.000Z`,
  }, id, client);

  const journal = await postJournalEntry(client, {
    date: day,
    memo: `Payment ${number}${input.reference ? ` — ref ${input.reference}` : ''}`,
    source: 'payment',
    sourceId: id,
    postedBy: recordedBy,
    lines: input.direction === 'in'
      ? [
          { accountCode: cashAccount, debit: input.amount, customerId: input.customerId, jobId: input.jobId ?? null },
          { accountCode: AR, credit: input.amount, customerId: input.customerId },
        ]
      : [
          { accountCode: AP, debit: input.amount, customerId: input.customerId },
          { accountCode: cashAccount, credit: input.amount, customerId: input.customerId, jobId: input.jobId ?? null },
        ],
  });

  if (input.invoiceId) {
    // paid sums counted payments; status derives from the fresh total against
    // the due date. The epsilon keeps float sums (0.1+0.2 style) from missing
    // "Paid" by a fraction of a shilling.
    await client.query(
      `UPDATE invoices SET
         paid = calc.paid,
         status = CASE
           WHEN calc.paid >= invoices.total - 0.005 THEN 'Paid'
           WHEN calc.paid > 0.005 THEN 'Partially Paid'
           WHEN invoices.due < CURRENT_DATE THEN 'Overdue'
           ELSE 'Unpaid'
         END
       FROM (
         SELECT COALESCE(${SIGNED()}, 0) AS paid FROM payments
         WHERE invoice_id = $1 AND ${COUNTED}
       ) AS calc
       WHERE invoices.id = $1`,
      [input.invoiceId],
    );
  }

  if (input.laundryOrderId) {
    // Recompute paid only — laundry status is fulfilment, not money.
    await client.query(
      `UPDATE laundry_orders SET paid = calc.paid
       FROM (
         SELECT COALESCE(${SIGNED()}, 0) AS paid FROM payments
         WHERE laundry_order_id = $1 AND ${COUNTED}
       ) AS calc
       WHERE laundry_orders.id = $1`,
      [input.laundryOrderId],
    );
  }

  // Customer balance = everything invoiced but not yet settled, across both
  // document families (the shape the seed data and finance views use).
  await client.query(
    `UPDATE customers SET balance =
       COALESCE((SELECT SUM(total - paid) FROM invoices WHERE customer_id = customers.id), 0) +
       COALESCE((SELECT SUM(total - paid) FROM laundry_orders WHERE customer_id = customers.id), 0)
     WHERE id = $1`,
    [input.customerId],
  );

  return { id, number, journal };
}

/** The settled document must exist and belong to the paying customer. */
async function expectCustomerDocument(
  client: PoolClient,
  table: 'invoices' | 'laundry_orders' | 'jobs',
  label: string,
  id: string,
  customerId: string,
): Promise<void> {
  const { rows } = await client.query<{ customer_id: string }>(
    `SELECT customer_id FROM ${table} WHERE id = $1`,
    [id],
  );
  if (!rows.length) throw new Error(`${label} not found`);
  if (rows[0].customer_id !== customerId) throw new Error(`${label} does not belong to that customer`);
}
