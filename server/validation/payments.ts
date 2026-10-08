import { z } from 'zod';
import type { Resource } from './resources';
import { dateText, idText, optionalText, text } from './common';

/**
 * Payments (Phase 1 data spine). A payment records money moving in or out
 * against one document (invoice, laundry order or job) using a payment
 * method, with an optional human reference (transaction id, cheque number).
 * Numbers are server-issued (PAY-00001) and are accepted-but-ignored on
 * create for backward compatibility with the generic handler contract.
 */

export const PAYMENT_DIRECTIONS = ['in', 'out'] as const;
export const PAYMENT_STATUSES = ['pending', 'confirmed', 'reconciled', 'voided'] as const;

export const paymentMethodsResource: Resource = {
  table: 'payment_methods',
  dataKey: 'paymentMethods',
  label: 'payment method',
  columns: {
    name: 'name',
    kind: 'kind',
    provider: 'provider',
    glAccountCode: 'gl_account_code',
    active: 'active',
  },
  create: z.strictObject({
    name: text,
    kind: z.enum(['cash', 'momo', 'bank', 'card', 'cheque', 'other']),
    provider: optionalText,
    glAccountCode: optionalText,
    active: z.boolean().optional(),
  }),
  row: z.object({
    id: idText,
    name: text,
    kind: z.enum(['cash', 'momo', 'bank', 'card', 'cheque', 'other']),
    provider: optionalText,
    glAccountCode: optionalText,
    active: z.boolean(),
  }),
};

/** Request-body schema for POST /api/payments (named so its inferred type is usable). */
const paymentCreate = z.strictObject({
  direction: z.enum(PAYMENT_DIRECTIONS),
  /** Stored positive; `direction` says which way the money moved. */
  amount: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z.number({ error: (issue) => (issue.input === undefined ? 'Required' : 'Must be a number') }).finite().positive('Must be more than zero'),
  ),
  customerId: idText,
  methodId: idText,
  invoiceId: optionalText.optional(),
  laundryOrderId: optionalText.optional(),
  jobId: optionalText.optional(),
  reference: optionalText.optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  /** Business day (Africa/Kampala); defaults to today in the service. */
  date: dateText.optional(),
});

export { paymentCreate };

export type PaymentCreate = z.infer<typeof paymentCreate>;

export const paymentsResource: Resource = {
  table: 'payments',
  dataKey: 'payments',
  label: 'payment',
  columns: {
    number: 'number',
    direction: 'direction',
    customerId: 'customer_id',
    methodId: 'method_id',
    amount: 'amount',
    currency: 'currency',
    reference: 'reference',
    invoiceId: 'invoice_id',
    laundryOrderId: 'laundry_order_id',
    jobId: 'job_id',
    status: 'status',
    receivedAt: 'received_at',
    recordedBy: 'recorded_by',
  },
  create: paymentCreate,
  row: z.object({
    id: idText,
    number: text,
    direction: z.enum(PAYMENT_DIRECTIONS),
    customerId: idText.nullable(),
    methodId: idText.nullable(),
    amount: z.number(),
    currency: z.string(),
    reference: z.string(),
    invoiceId: idText.nullable(),
    laundryOrderId: idText.nullable(),
    jobId: idText.nullable(),
    status: z.enum(PAYMENT_STATUSES),
    receivedAt: z.string(),
  }),
};
