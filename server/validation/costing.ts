import { z } from 'zod';
import { idText, money, optionalText } from './common';

/**
 * Job costing (Phase 1 data spine). Cost lines are the truth behind
 * jobs.cost; timesheets feed the labour lines at the employee's rate.
 */

/** ISO timestamp, e.g. 2026-09-27T09:30:00Z (or with offset). */
export const datetimeText = z
  .string({ error: 'Required' })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/, 'Use an ISO timestamp');

export const TIMESHEET_STATUSES = ['open', 'approved'] as const;

/** POST /api/costs — one cost line; amount wins over qty × unitCost. */
export const jobCostCreate = z
  .strictObject({
    jobId: idText,
    categoryId: idText.optional(),
    description: optionalText.optional(),
    qty: money.optional(),
    unitCost: money.optional(),
    amount: money.optional(),
    supplierId: idText.optional(),
  })
  .refine((value) => value.amount !== undefined || value.unitCost !== undefined, {
    message: 'Provide amount or unitCost',
    path: ['amount'],
  });

/** POST /api/timesheets — clock a field shift against a job. */
export const timesheetCreate = z.strictObject({
  employeeId: idText,
  jobId: idText.optional(),
  startedAt: datetimeText,
  endedAt: datetimeText.optional(),
  minutes: z.number().int().positive().optional(),
  rate: money.optional(),
});
