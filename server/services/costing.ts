import type { PoolClient } from 'pg';
import { pool } from '../db';

/**
 * Job costing (Phase 1 data spine).
 *
 * Cost lines are the truth: once a job has at least one line in `job_costs`,
 * the service recomputes `jobs.cost = SUM(job_costs.amount)` after every
 * write, so the margin figures stop being the legacy 36% estimate (plan
 * concern #5). Jobs without any line keep their seeded estimate — the plan's
 * "keep the old values visible until the ledger is accepted" rule.
 *
 * `amount` is qty × unit_cost when the caller supplies both, or the raw
 * amount when it supplies amount directly; the rounded product wins so a
 * 2.5 × 12,333.33 line lands exactly.
 */

const rounded = (value: number) => Math.round(value * 100) / 100;

export type JobCostInput = {
  jobId: string;
  categoryId?: string | null;
  description?: string;
  qty?: number;
  unitCost?: number;
  amount?: number;
  supplierId?: string | null;
  createdBy?: string | null;
};

/** The recompute every cost write ends with. Must run in the caller's transaction. */
export async function recomputeJobCost(client: PoolClient, jobId: string): Promise<number> {
  const { rows } = await client.query<{ total: number }>(
    `WITH totals AS (
       SELECT COALESCE(SUM(amount), 0) AS total FROM job_costs WHERE job_id = $1
     )
     UPDATE jobs SET cost = totals.total
     FROM totals
     WHERE jobs.id = $1 AND EXISTS (SELECT 1 FROM job_costs WHERE job_id = $1)
     RETURNING cost::float8 AS total`,
    [jobId],
  );
  return rows[0]?.total ?? 0;
}

/** Insert one cost line and refresh jobs.cost. Runs in its own transaction. */
export async function addJobCost(input: JobCostInput): Promise<{ id: number; jobCost: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await addJobCostInTx(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction body for a cost line insert, composable like the payments service. */
export async function addJobCostInTx(
  client: PoolClient,
  input: JobCostInput,
): Promise<{ id: number; jobCost: number }> {
  const amount =
    input.amount !== undefined
      ? rounded(input.amount)
      : rounded((input.qty ?? 1) * (input.unitCost ?? 0));

  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO job_costs (job_id, category_id, description, qty, unit_cost, amount, supplier_id, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'manual', $8) RETURNING id`,
    [
      input.jobId,
      input.categoryId ?? null,
      input.description ?? '',
      input.qty ?? 1,
      input.unitCost ?? 0,
      amount,
      input.supplierId ?? null,
      input.createdBy ?? null,
    ],
  );

  const jobCost = await recomputeJobCost(client, input.jobId);
  return { id: rows[0].id, jobCost };
}

/**
 * Approve a timesheet: stamp the approver and minutes, then generate the
 * labour cost line (source 'timesheet', linked by timesheet_id — the partial
 * unique index makes re-approval idempotent) and refresh jobs.cost.
 * Runs in its own transaction.
 */
export async function approveTimesheet(
  timesheetId: number,
  approvedBy: string | null,
): Promise<{ minutes: number; jobCost: number; costLineId: number | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await approveTimesheetInTx(client, timesheetId, approvedBy);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction body for approval, composable like the other services. */
export async function approveTimesheetInTx(
  client: PoolClient,
  timesheetId: number,
  approvedBy: string | null,
): Promise<{ minutes: number; jobCost: number; costLineId: number | null }> {
  {

    const { rows } = await client.query<{
      employee_id: string;
      job_id: string | null;
      started_at: Date;
      ended_at: Date | null;
      minutes: number | null;
      rate: number;
      approved_by: string | null;
    }>(
      `SELECT employee_id, job_id, started_at, ended_at, minutes, rate::float8 AS rate, approved_by
       FROM timesheets WHERE id = $1 FOR UPDATE`,
      [timesheetId],
    );
    if (!rows.length) throw new Error('Timesheet not found');
    const sheet = rows[0];
    if (sheet.approved_by) throw new Error('Timesheet already approved');
    if (!sheet.job_id) throw new Error('Timesheet has no job to cost against');
    if (!sheet.ended_at) throw new Error('Timesheet is still open');

    // Minutes: stored value, else derived from the clock pair.
    const minutes =
      sheet.minutes ??
      Math.max(0, Math.round((sheet.ended_at.getTime() - sheet.started_at.getTime()) / 60000));
    await client.query(`UPDATE timesheets SET minutes = $2, approved_by = $3 WHERE id = $1`, [
      timesheetId,
      minutes,
      approvedBy,
    ]);

    // The labour line: minutes × rate, linked to the sheet. ON CONFLICT keeps
    // a double-approval race from inserting two lines.
    const amount = rounded((minutes / 60) * sheet.rate);
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO job_costs (job_id, category_id, description, qty, unit_cost, amount, source, timesheet_id, created_by)
       VALUES ($1, (SELECT id FROM cost_categories WHERE name = 'Labour'), $2, $3, $4, $5, 'timesheet', $6, $7)
       ON CONFLICT (timesheet_id) WHERE timesheet_id IS NOT NULL DO UPDATE SET amount = EXCLUDED.amount
       RETURNING id`,
      [
        sheet.job_id,
        `Timesheet: ${minutes} min`,
        minutes / 60,
        sheet.rate,
        amount,
        timesheetId,
        approvedBy,
      ],
    );

    const jobCost = await recomputeJobCost(client, sheet.job_id);
    return { minutes, jobCost, costLineId: inserted.rows[0]?.id ?? null };
  }
}
