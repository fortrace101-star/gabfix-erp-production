import { z } from 'zod';
import { dateText, idText, money, optionalDateText, optionalMoney, optionalText } from './common';

/**
 * Laundry orders (Phase 1 data spine).
 *
 * The lifecycle stamps (ready_at, collected_at) are derived from status
 * transitions on the server and are never client-writable — the same rule as
 * the job lifecycle timestamps from 009. promised_at is the one date the
 * front office does set, at intake, because it is a commitment not an
 * observation. Statuses are the plan's fulfilment stages; money never moves
 * them (payments service).
 */

export const LAUNDRY_STATUSES = ['Received', 'Washing', 'Drying', 'Ready', 'Collected'] as const;

/** One priced line of an intake. amount = qty × unitPrice, or explicit. */
export const laundryItemCreate = z.strictObject({
  serviceId: idText.optional(),
  description: optionalText.optional(),
  qty: optionalMoney,
  unit: optionalText.optional(),
  unitPrice: optionalMoney,
  amount: optionalMoney,
});

export const laundryIntakeCreate = z.strictObject({
  customerId: idText,
  promisedAt: optionalDateText,
  jobId: idText.optional(),
  weightKg: optionalMoney,
  pieces: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
      z.number({ error: 'Must be a number' }).int('Must be a whole number of pieces').nonnegative('Must be zero or more'),
    )
    .optional(),
  items: optionalText.optional(),
  lines: z.array(laundryItemCreate).max(50).optional(),
});

export const laundryStatusPatch = z.strictObject({
  status: z.enum(LAUNDRY_STATUSES, { error: 'Unknown laundry status' }),
});
