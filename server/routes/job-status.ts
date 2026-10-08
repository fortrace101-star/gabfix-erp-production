import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { parseBody } from '../validation/common';
import { dispatchEvent } from '../services/notifications';
import { seedStageChecklist } from '../services/job-checklist';
import { publish } from '../services/realtime';

/**
 * Job lifecycle transitions (plan v5 D2). The portal's Accept/Start/Complete
 * actions land here; the server owns the stamps (started_at/completed_at/
 * invoiced_at/paid_at) and writes a job_events audit row per transition —
 * the client cannot forge the timeline. Notifications ride dispatchEvent on
 * completion (same path as PATCH /api/jobs).
 */

export const jobStatusRouter = Router();

const STATUSES = ['Quoted', 'Scheduled', 'In Progress', 'Completed', 'Invoiced', 'Paid'] as const;

const statusPatch = z.strictObject({
  status: z.enum(STATUSES),
});

const STAMP_COLUMN: Record<(typeof STATUSES)[number], string | null> = {
  Quoted: 'quote_date',
  Scheduled: 'scheduled_date',
  'In Progress': 'started_at',
  Completed: 'completed_at',
  Invoiced: 'invoiced_at',
  Paid: 'paid_at',
};

/** PATCH /api/jobs/:id/status — one lifecycle step with a server-owned stamp. */
jobStatusRouter.patch('/:id/status', async (req: Request, res: Response) => {
  const input = parseBody(statusPatch, req.body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, customer_id FROM jobs WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    const job = rows[0];
    if (!job) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const stamp = STAMP_COLUMN[input.status];
    const now = new Date();
    if (stamp) {
      await client.query(
        `UPDATE jobs SET status = $2, ${stamp} = $3 WHERE id = $1`,
        [job.id, input.status, now],
      );
    } else {
      await client.query(`UPDATE jobs SET status = $2 WHERE id = $1`, [job.id, input.status]);
    }

    await client.query(
      `INSERT INTO job_events (job_id, kind, actor_employee_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [job.id, `status:${input.status}`, req.user?.id ?? null, { from: job.status, at: now.toISOString() }],
    );

    // Assignment bookkeeping: mark the technician's row accepted/completed.
    if (input.status === 'In Progress' || input.status === 'Completed') {
      const column = input.status === 'In Progress' ? 'accepted_at' : 'completed_at';
      await client.query(
        `UPDATE job_assignments SET ${column} = $2 WHERE job_id = $1 AND employee_id = $3`,
        [job.id, now, req.user?.id],
      );
    }

    // Every stage a job enters brings its own checklist (migration 025). Seeding
    // is skipped when that stage already has rows, so crew edits are preserved.
    await seedStageChecklist(client, job.id, input.status, req.user?.id ?? null);

    await client.query('COMMIT');
    res.json({ id: job.id, status: input.status, at: now.toISOString() });

    if (input.status === 'Completed') {
      const c = await pool.connect();
      try {
        await dispatchEvent(c, { type: 'job.completed', entityType: 'jobs', entityId: job.id });
        // CSR feedback outreach (plan): seed the 1-day-later check-in for any
        // completed job that has no follow-up row yet; the CSR pane consumes
        // it (cadence re-queues every 2 days until feedback arrives).
        await c.query(
          `INSERT INTO follow_ups (type, owner_role, customer_id, job_id, due_at,
                                   follow_up_after_days, notes)
           SELECT 'feedback_outreach', 'csr', $1, $2, now() + INTERVAL '1 day', 2, $3
           WHERE $1 IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM feedback WHERE job_id = $2)
             AND NOT EXISTS (SELECT 1 FROM follow_ups
                             WHERE job_id = $2 AND type = 'feedback_outreach')`,
          [job.customer_id, job.id, `Feedback check-in for ${job.number}`],
        );
      } finally {
        c.release();
      }
    }
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    fail(res, error, 'Job status change failed');
  } finally {
    client.release();
  }
});
