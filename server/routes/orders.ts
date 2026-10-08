import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { dateText, idText, money, optionalText, parseBody, text } from '../validation/common';
import { JOB_PRIORITIES } from '../validation/resources';
import { can } from './permission-matrix';
import { dispatchEvent } from '../services/notifications';
import { nextNumber } from '../services/numbering';
import { publish } from '../services/realtime';

/**
 * Order lifecycle (plan: cleaning-operations-workflow.md, phase P1).
 *
 *   POST /api/orders/proposals   — salesperson (or CSR) creates a Proposed order
 *   POST /api/orders/:id/share   — tokenised read-only link, safe for WhatsApp
 *   POST /api/orders/:id/confirm — phone verification; the ONLY way into
 *                                  Confirmed (manager/customer support)
 *   POST /api/orders/:id/cancel  — manager only, reason required, never after
 *                                  Completed
 *   POST /api/orders/:id/close   — customer support's terminal action; needs
 *                                  feedback first (and the stage checklist)
 *   GET  /proposal/:token        — public share page (mounted at the root, like
 *                                  /feedback/:token, outside the /api guard)
 *
 * Every transition writes a job_events audit row (the client cannot forge the
 * timeline), moves stamps server-side and broadcasts `job-updated` over SSE.
 * Capabilities come from the permission matrix — a salesperson can never hold
 * `confirm_orders`, so nobody confirms their own proposal.
 */

export const ordersRouter = Router();
/** Public tokenised proposal page — mounted at `/` so it stays off the guard. */
export const proposalRouter = Router();

const JOB_SOURCES = ['website', 'salesperson', 'admin', 'other'] as const;

/** A proposal carries the client's request; price/date details firm up later. */
const proposalCreate = z.strictObject({
  customerId: idText,
  serviceId: idText,
  date: dateText,
  revenue: money.optional(),
  priority: z.enum(JOB_PRIORITIES).optional(),
  siteAddress: optionalText.optional(),
  source: z.enum(JOB_SOURCES).optional(),
});

/** Cancellations are audited — the reason is never optional (plan §2). */
const cancelBody = z.strictObject({ reason: text });

/** Statuses from which cancellation is barred: resources are already spent. */
const PAST_COMPLETION = ['Completed', 'Invoiced', 'Paid', 'Closed'] as const;

function requireCapability(capability: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user && can(req.user.role, capability)) return next();
    res.status(403).json({ error: 'Insufficient capability' });
  };
}

type JobRow = { id: string; status: string; proposed_by: string | null };

/** One lifecycle write: lock the job, validate, mutate, audit, dispatch. */
async function transition(
  req: Request,
  res: Response,
  options: {
    /** Business-rule gate; return an error (409 unless overridden) to refuse. */
    validate: (job: JobRow) => { error: string; status?: number } | null;
    apply: (client: PoolClient, job: JobRow) => Promise<Record<string, unknown>>;
    dispatch?: (client: PoolClient, jobId: string) => Promise<void>;
    fallback: string;
  },
): Promise<void> {
  const id = String(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, proposed_by::text AS proposed_by FROM jobs WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const job = rows[0] as JobRow | undefined;
    if (!job) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const problem = options.validate(job);
    if (problem) {
      await client.query('ROLLBACK');
      res.status(problem.status ?? 409).json({ error: problem.error });
      return;
    }

    const extra = await options.apply(client, job);
    if (options.dispatch) await options.dispatch(client, job.id);

    await client.query('COMMIT');
    res.json({ id: job.id, ...extra });
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    // Business-rule throws from `apply` carry their own HTTP status (409/422).
    const status = (error as { status?: number })?.status;
    if (status && error instanceof Error) {
      res.status(status).json({ error: error.message });
      return;
    }
    fail(res, error, options.fallback);
  } finally {
    client.release();
  }
}

/** Write the audit row every transition owes the job timeline. */
async function audit(
  client: PoolClient,
  jobId: string,
  kind: string,
  actorId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO job_events (job_id, kind, actor_employee_id, payload) VALUES ($1, $2, $3, $4)`,
    [jobId, kind, actorId, JSON.stringify(payload)],
  );
}

/**
 * POST /api/orders/:id/share — mint (or reuse) the job's share token and stamp
 * `share_sent_at` so the manager's queue can see it was shared. Re-sharing
 * returns the same token: a WhatsApp thread keeps one stable link.
 */
ordersRouter.post('/:id/share', requireCapability('create_proposals'), async (req, res) => {
  await transition(req, res, {
    validate: (job) =>
      job.status === 'Proposed' ? null : { error: 'Only a Proposed order can be shared' },
    apply: async (client, job) => {
      const { rows } = await client.query<{ share_token: string | null }>(
        `SELECT share_token::text AS share_token FROM jobs WHERE id = $1`,
        [job.id],
      );
      const shareToken = rows[0]?.share_token ?? randomUUID();
      await client.query(`UPDATE jobs SET share_token = $2, share_sent_at = now() WHERE id = $1`, [
        job.id,
        shareToken,
      ]);
      await audit(client, job.id, 'shared', req.user?.id ?? null, {
        at: new Date().toISOString(),
      });
      return { shareToken, shareUrl: `/proposal/${shareToken}` };
    },
    dispatch: async (client, jobId) => {
      await dispatchEvent(client, { type: 'order.proposed.shared', entityType: 'jobs', entityId: jobId });
    },
    fallback: 'Could not share proposal',
  });
});

/**
 * POST /api/orders/:id/confirm — phone verification stamps `confirmed_at/by`
 * and is the only way into `Confirmed`. The capability gate excludes `sales`
 * entirely (permission matrix), so nobody ever verifies their own proposal.
 */
ordersRouter.post('/:id/confirm', requireCapability('confirm_orders'), async (req, res) => {
  await transition(req, res, {
    validate: (job) =>
      job.status === 'Proposed'
        ? null
        : { error: `Only a Proposed order can be confirmed (job is ${job.status})` },
    apply: async (client, job) => {
      await client.query(
        `UPDATE jobs SET status = 'Confirmed', confirmed_at = now(), confirmed_by = $2 WHERE id = $1`,
        [job.id, req.user?.id ?? null],
      );
      await audit(client, job.id, 'status:Confirmed', req.user?.id ?? null, {
        from: job.status,
        at: new Date().toISOString(),
      });
      return { status: 'Confirmed' };
    },
    dispatch: async (client, jobId) => {
      await dispatchEvent(client, { type: 'order.confirmed', entityType: 'jobs', entityId: jobId });
    },
    fallback: 'Could not confirm order',
  });
});

/**
 * POST /api/orders/:id/cancel — manager only (`cancel_orders`), reason
 * required, and never once the job has reached Completed: resources are spent,
 * so the only path left is invoiced → paid → follow-up → closed.
 */
ordersRouter.post('/:id/cancel', requireCapability('cancel_orders'), async (req, res) => {
  const input = parseBody(cancelBody, req.body);
  await transition(req, res, {
    validate: (job) => {
      if (job.status === 'Cancelled') return { error: 'Job is already cancelled' };
      if ((PAST_COMPLETION as readonly string[]).includes(job.status)) {
        return { error: 'A completed job cannot be cancelled' };
      }
      return null;
    },
    apply: async (client, job) => {
      await client.query(`UPDATE jobs SET status = 'Cancelled', cancel_reason = $2 WHERE id = $1`, [
        job.id,
        input.reason,
      ]);
      await audit(client, job.id, 'status:Cancelled', req.user?.id ?? null, {
        from: job.status,
        reason: input.reason,
        at: new Date().toISOString(),
      });
      return { status: 'Cancelled' };
    },
    // Plan §8: no customer notification for cancellations yet.
    fallback: 'Could not cancel job',
  });
});

/**
 * POST /api/orders/:id/close — customer support's terminal action. Two hard
 * gates (plan §2.1 and decision #11): feedback must exist for the job, and the
 * current stage's checklist must be complete. Closed stamps `closed_at`.
 */
ordersRouter.post('/:id/close', requireCapability('close_orders'), async (req, res) => {
  await transition(req, res, {
    validate: (job) => {
      if (job.status === 'Closed') return { error: 'Job is already closed' };
      if (job.status === 'Cancelled') return { error: 'A cancelled job cannot be closed' };
      if (job.status === 'Proposed') {
        return { error: 'A proposal is confirmed first — cancel it instead if the client declined' };
      }
      return null;
    },
    apply: async (client, job) => {
      const feedback = await client.query(`SELECT 1 FROM feedback WHERE job_id = $1`, [job.id]);
      if (!feedback.rows.length) {
        throw Object.assign(new Error('Record customer feedback before closing this job'), {
          status: 409,
        });
      }
      // Hard checklist gate only here — field stages stay advisory (plan §6).
      const open = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM job_checklist_items
          WHERE job_id = $1 AND stage = $2 AND NOT done`,
        [job.id, job.status],
      );
      if (Number(open.rows[0]?.count ?? 0) > 0) {
        throw Object.assign(new Error(`Finish the ${job.status} checklist before closing this job`), {
          status: 422,
        });
      }
      await client.query(`UPDATE jobs SET status = 'Closed', closed_at = now() WHERE id = $1`, [job.id]);
      await audit(client, job.id, 'status:Closed', req.user?.id ?? null, {
        from: job.status,
        at: new Date().toISOString(),
      });
      return { status: 'Closed' };
    },
    fallback: 'Could not close job',
  });
});

// ── Public share page (plan P1: tokenised, read-only, safe for WhatsApp) ──────

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Human phrasing for the stages a customer may see on the link. */
const STAGE_LABEL: Record<string, string> = {
  Proposed: 'Awaiting confirmation',
  Confirmed: 'Confirmed',
  Inspection: 'Inspection scheduled',
  Quoted: 'Quote prepared',
  Scheduled: 'Scheduled',
  'In Progress': 'Work in progress',
  Completed: 'Completed',
  Invoiced: 'Invoiced',
  Paid: 'Paid',
  'Follow-up': 'Follow-up',
  Closed: 'Closed',
  Cancelled: 'Cancelled',
};

/** GET /proposal/:token — read-only proposal; no auth, no data beyond the order. */
proposalRouter.get('/proposal/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT j.number, j.status, j.date::text AS date, j.site_address, j.revenue::float8 AS revenue,
              c.name AS customer_name, s.name AS service_name, e.name AS proposed_by_name
       FROM jobs j
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN services s ON s.id = j.service_id
       LEFT JOIN employees e ON e.id = j.proposed_by
       WHERE j.share_token = $1`,
      [String(req.params.token)],
    );
    if (!rows.length) {
      res
        .status(404)
        .send('<html><body><h1>Proposal link not valid</h1><p>This link has expired or was never issued.</p></body></html>');
      return;
    }
    const job = rows[0] as {
      number: string;
      status: string;
      date: string;
      site_address: string | null;
      revenue: number;
      customer_name: string | null;
      service_name: string | null;
      proposed_by_name: string | null;
    };
    const label = STAGE_LABEL[job.status] ?? job.status;
    const consoleUrl = process.env.CONSOLE_URL || 'https://gabfix-administrator.vercel.app';
    const site = job.site_address ? `<p><strong>Site</strong><br>${esc(job.site_address)}</p>` : '';
    const value = job.revenue
      ? `<div class="row"><span class="label">Quoted value</span><span>${esc(job.revenue)}</span></div>`
      : '';
    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gabfix proposal ${esc(job.number)}</title>
<style>
body{font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#111827}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:24px}
.badge{display:inline-block;padding:4px 10px;border-radius:999px;background:#f3f4f6;font-size:13px;font-weight:600}
.row{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #f3f4f6}
.row:last-child{border-bottom:none}
.label{color:#6b7280}
a.cta{display:inline-block;margin-top:20px;padding:10px 20px;background:#111827;color:#fff;text-decoration:none;border-radius:8px}
footer{margin-top:16px;color:#9ca3af;font-size:12px;text-align:center}
</style></head>
<body>
<div class="card">
  <span class="badge">${esc(label)}</span>
  <h1>Proposal ${esc(job.number)}</h1>
  <div class="row"><span class="label">Service</span><span>${esc(job.service_name ?? '—')}</span></div>
  <div class="row"><span class="label">For</span><span>${esc(job.customer_name ?? '—')}</span></div>
  <div class="row"><span class="label">Requested date</span><span>${esc(job.date)}</span></div>
  ${value}
  ${site}
  <a class="cta" href="${esc(consoleUrl)}">Open in the Gabfix Console →</a>
</div>
<footer>Shared by ${esc(job.proposed_by_name ?? 'the Gabfix team')} · read-only proposal link</footer>
</body>
</html>`);
  } catch (error) {
    fail(res, error, 'Could not load proposal');
  }
});



ordersRouter.post('/proposals', requireCapability('create_proposals'), async (req, res) => {
  try {
    const input = parseBody(proposalCreate, req.body);
    const actor = req.user;
    const id = `j${Date.now()}`;
    // Provenance: the salesperson's portal entry came in through the portal;
    // an explicit source (a website order relayed by CSR) wins over the default.
    const source = input.source ?? (actor?.role === 'sales' ? 'salesperson' : 'admin');

    const client = await pool.connect();
    let number = '';
    try {
      await client.query('BEGIN');
      number = await nextNumber(client, 'job');
      const { rows } = await client.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, priority,
                           revenue, site_address, source, proposed_by, salesperson_id,
                           scheduled_date)
         VALUES ($1, $2, $3, $4, $5, 'Proposed', COALESCE($6, 'Normal'), COALESCE($7, 0), $8, $9, $10, $11, $5)
         RETURNING id, number`,
        [
          id,
          number,
          input.customerId,
          input.serviceId,
          input.date,
          input.priority ?? null,
          input.revenue ?? 0,
          input.siteAddress ?? null,
          source,
          actor?.id ?? null,
          // Portal panes filter "my proposals" by salesperson; keep that column
          // in step with the creator when a salesperson enters the proposal.
          actor?.role === 'sales' ? actor.id : null,
        ],
      );
      number = rows[0].number;
      await audit(client, id, 'status:Proposed', actor?.id ?? null, {
        from: null,
        at: new Date().toISOString(),
        source,
      });
      await dispatchEvent(client, { type: 'order.proposed', entityType: 'jobs', entityId: id });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json({ id, number, status: 'Proposed', source });
    publish({ type: 'job-created', by: actor?.name });
  } catch (error) {
    fail(res, error, 'Could not create proposal');
  }
});

