import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../validation/common';
import { jobCostCreate, timesheetCreate } from '../validation/costing';
import { addJobCostInTx, approveTimesheetInTx, recomputeJobCost } from '../services/costing';
import { pool } from '../db';
import { migrate } from '../migrate';

// ── Pure schema tests (no database) ────────────────────────────────────────

test('job cost line requires amount or unitCost, and computes from qty × unitCost', () => {
  assert.throws(() => parseBody(jobCostCreate, { jobId: 'j1', description: 'nothing to price' }));
  const parsed = parseBody(jobCostCreate, { jobId: 'j1', qty: '2.5', unitCost: '12000' }) as { qty: number; unitCost: number };
  assert.equal(parsed.qty, 2.5);
  assert.equal(parsed.unitCost, 12000);
});

test('job cost line rejects unknown fields', () => {
  try {
    parseBody(jobCostCreate, { jobId: 'j1', amount: 5, vendorId: 'v1' });
    assert.fail('expected vendorId to be rejected');
  } catch (error) {
    assert.equal((error as { fields?: Record<string, string> }).fields?.vendorId, 'Unknown field');
  }
});

test('timesheet requires an ISO timestamp pair and rejects bad shapes', () => {
  const parsed = parseBody(timesheetCreate, {
    employeeId: '00000000-0000-4000-8000-000000000001',
    jobId: 'j1',
    startedAt: '2026-09-27T09:30:00Z',
    endedAt: '2026-09-27T13:15:00Z',
  }) as { startedAt: string };
  assert.equal(parsed.startedAt, '2026-09-27T09:30:00Z');
  assert.throws(() =>
    parseBody(timesheetCreate, { employeeId: 'e1', startedAt: '27/09 9am', endedAt: '2026-09-27T13:15:00Z' }),
  );
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

  test('cost lines recompute jobs.cost and timesheet approval is idempotent', { timeout: 20_000 }, async () => {
    const run = Date.now();
    const jobId = `jcost-${run}`;
    const employeeId = '00000000-0000-4000-8000-000000000001';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, revenue, cost)
         VALUES ($1, $2, 'c1', 's1', '2026-09-27', 'In Progress', 500000, 180000)`,
        [jobId, `JOB-COST-${run}`],
      );

      // Manual material line: 2.5 × 12000 = 30000. jobs.cost flips from the
      // 36% legacy estimate to the lines' total.
      const first = await addJobCostInTx(client, {
        jobId,
        categoryId: 'cat-materials',
        description: 'Detergent + fittings',
        qty: 2.5,
        unitCost: 12000,
        supplierId: 'sup1',
      });
      assert.equal(first.jobCost, 30000);

      // Second line by explicit amount.
      const second = await addJobCostInTx(client, { jobId, categoryId: 'cat-transport', amount: 45000 });
      assert.equal(second.jobCost, 75000);

      // Timesheet: 09:00 → 13:00 at 15000/h = 4h → 60000 labour line.
      const sheet = await client.query<{ id: number }>(
        `INSERT INTO timesheets (employee_id, job_id, started_at, ended_at, rate)
         VALUES ($1, $2, '2026-09-27T09:00:00Z', '2026-09-27T13:00:00Z', 15000) RETURNING id`,
        [employeeId, jobId],
      );
      const approved = await approveTimesheetInTx(client, sheet.rows[0].id, employeeId);
      assert.equal(approved.minutes, 240);
      assert.equal(approved.jobCost, 135000);
      assert.ok(approved.costLineId);

      // Re-approval is rejected (already approved), and the cost total did
      // not double: still one labour line via the partial unique index.
      await assert.rejects(
        approveTimesheetInTx(client, sheet.rows[0].id, employeeId),
        /already approved/,
      );
      const stillTotal = await recomputeJobCost(client, jobId);
      assert.equal(stillTotal, 135000);

      const lineCount = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM job_costs WHERE job_id = $1 AND source = 'timesheet'`,
        [jobId],
      );
      assert.equal(lineCount.rows[0].n, '1');

      // Deleting the job cascades its cost lines and timesheets.
      await client.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
      const leftovers = await client.query<{ costs: string; sheets: string }>(
        `SELECT
           (SELECT COUNT(*)::text FROM job_costs WHERE job_id = $1) AS costs,
           (SELECT COUNT(*)::text FROM timesheets WHERE job_id = $1) AS sheets`,
        [jobId],
      );
      assert.equal(leftovers.rows[0].costs, '0');
      assert.equal(leftovers.rows[0].sheets, '0');

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
} else {
  test('costing integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[costing.test] PostgreSQL unreachable — integration tests skipped');
  });
}
