import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../validation/common';
import { jobsResource } from '../validation/resources';
import { pool, getData } from '../db';
import { migrate } from '../migrate';

// ── Pure schema tests (no database) ────────────────────────────────────────

test('job create accepts the new date, priority and site fields', () => {
  const parsed = parseBody(jobsResource.create, {
    customerId: 'c1',
    serviceId: 's1',
    date: '2026-09-27',
    revenue: 100,
    scheduledDate: '2026-09-28',
    quoteDate: '2026-09-26',
    promisedAt: '2026-09-30',
    priority: 'Urgent',
    salespersonId: '00000000-0000-4000-8000-000000000001',
    managerId: '00000000-0000-4000-8000-000000000001',
    siteAddress: 'Plot 4, Kampala Road',
    lat: '0.3476',
    lng: '32.5825',
  }) as { priority: string; scheduledDate?: string; lat: number };
  assert.equal(parsed.priority, 'Urgent');
  assert.equal(parsed.scheduledDate, '2026-09-28');
  assert.equal(parsed.lat, 0.3476);
});

test('job create still works with only the legacy fields', () => {
  const parsed = parseBody(jobsResource.create, {
    customerId: 'c1',
    serviceId: 's1',
    date: '2026-09-27',
    revenue: 100,
  }) as { priority?: string; scheduledDate?: string };
  assert.ok(!('priority' in parsed) || parsed.priority === undefined);
});

test('job create rejects a bad priority and a bad date format', () => {
  assert.throws(() =>
    parseBody(jobsResource.create, {
      customerId: 'c1',
      serviceId: 's1',
      date: '2026-09-27',
      revenue: 100,
      priority: 'ASAP',
    }),
  );
  assert.throws(() =>
    parseBody(jobsResource.create, {
      customerId: 'c1',
      serviceId: 's1',
      date: '2026-09-27',
      revenue: 100,
      scheduledDate: '27/09/2026',
    }),
  );
});

test('job patch accepts the new fields but rejects lifecycle timestamps', () => {
  const patched = parseBody(jobsResource.patch!, { scheduledDate: '2026-10-01', priority: 'High' }) as { priority: string };
  assert.equal(patched.priority, 'High');
  // startedAt is server-managed: not in the patch schema, so strict parsing
  // rejects it with 422 rather than dropping it.
  try {
    parseBody(jobsResource.patch!, { startedAt: '2026-09-27T09:00:00Z' });
    assert.fail('expected startedAt to be rejected');
  } catch (error) {
    assert.equal((error as { fields?: Record<string, string> }).fields?.startedAt, 'Unknown field');
  }
});

// ── Integration tests (real PostgreSQL; skipped when it is unreachable) ────

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

  test('009 backfills job dates and the new tables work', { timeout: 20_000 }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Backfill: every seeded job has a scheduled_date, and completed ones
      // carry start/complete instants pinned to the legacy job day.
      const backfill = await client.query<{ missing: string; completed_missing: string }>(
        `SELECT
           (SELECT COUNT(*)::text FROM jobs WHERE scheduled_date IS NULL) AS missing,
           (SELECT COUNT(*)::text FROM jobs WHERE status = 'Completed' AND completed_at IS NULL) AS completed_missing`,
      );
      assert.equal(backfill.rows[0].missing, '0');
      assert.equal(backfill.rows[0].completed_missing, '0');

      // Fixture job to exercise the new tables.
      const run = Date.now();
      const jobId = `jtest-${run}`;
      const employeeId = '00000000-0000-4000-8000-000000000001';
      await client.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, revenue, scheduled_date)
         VALUES ($1, $2, 'c1', 's1', '2026-09-27', 'Scheduled', 1000, '2026-09-27')`,
        [jobId, `JOB-PT-${run}`],
      );

      await client.query(
        `INSERT INTO job_assignments (job_id, employee_id, role) VALUES ($1, $2, 'technician')`,
        [jobId, employeeId],
      );
      await client.query(
        `INSERT INTO job_events (job_id, kind, actor_employee_id, payload) VALUES ($1, 'created', $2, '{"via":"test"}')`,
        [jobId, employeeId],
      );

      const assignment = await client.query<{ role: string }>(
        `SELECT role FROM job_assignments WHERE job_id = $1 AND employee_id = $2`,
        [jobId, employeeId],
      );
      assert.equal(assignment.rows[0].role, 'technician');

      const events = await client.query<{ kind: string; payload: Record<string, string> }>(
        `SELECT kind, payload FROM job_events WHERE job_id = $1`,
        [jobId],
      );
      assert.equal(events.rows.length, 1);
      assert.equal(events.rows[0].kind, 'created');
      assert.equal(events.rows[0].payload.via, 'test');

      // Cascade: deleting the job removes its assignments and events.
      await client.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
      const leftovers = await client.query<{ assignments: string; events: string }>(
        `SELECT
           (SELECT COUNT(*)::text FROM job_assignments WHERE job_id = $1) AS assignments,
           (SELECT COUNT(*)::text FROM job_events WHERE job_id = $1) AS events`,
        [jobId],
      );
      assert.equal(leftovers.rows[0].assignments, '0');
      assert.equal(leftovers.rows[0].events, '0');

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    });

  test('Phase 1c: /api/data exposes the jobAssignments/jobEvents/timesheets/jobCosts slices', { timeout: 20_000 }, async () => {
    const run = Date.now().toString(36);
    const jobId = `jread-${run}`;
    const employeeId = '00000000-0000-4000-8000-000000000001';
    try {
      await pool.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, revenue, scheduled_date)
           VALUES ($1, $2, 'c1', 's1', '2026-09-27', 'In Progress', 1000, '2026-09-27')`,
        [jobId, `JOB-READ-${run}`],
      );
      await pool.query(
        `INSERT INTO job_assignments (job_id, employee_id, role)
           VALUES ($1, $2, 'technician')`,
        [jobId, employeeId],
      );
      await pool.query(
        `INSERT INTO job_events (job_id, kind, actor_employee_id, payload)
           VALUES ($1, 'started', $2, '{"via":"test"}')`,
        [jobId, employeeId],
      );

      const data = await getData();
      const assignments = (data.jobAssignments ?? []) as Array<{ jobId: string }>;
      assert.ok(
        assignments.some((a) => a.jobId === jobId),
        'jobAssignments slice should expose the seeded assignment',
      );
      const events = (data.jobEvents ?? []) as Array<{ jobId: string; kind: string }>;
      assert.ok(
        events.some((e) => e.jobId === jobId && e.kind === 'started'),
        'jobEvents slice should expose the lifecycle event',
      );
      assert.ok(Array.isArray(data.timesheets), 'timesheets slice is exposed');
      assert.ok(Array.isArray(data.jobCosts), 'jobCosts slice is exposed');
    } finally {
      await pool.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
    }
  });
} else {
  test('jobs-dates integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[jobs-dates.test] PostgreSQL unreachable — integration tests skipped');
  });
}
