import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { fail } from '../lib/http';
import { parseBody, text, optionalText, money, idText } from '../validation/common';
import { publish } from '../services/realtime';
import { can } from './permission-matrix';

/**
 * Role-dashboard writes (plan: Sales/CSR/Supervisor panes).
 *
 *   POST   /api/crm/leads              — enter a client into the workflow
 *   PATCH  /api/crm/leads/:id          — move stage, value, next follow-up
 *   POST   /api/crm/follow-ups         — schedule a reminder (date + time)
 *   PATCH  /api/crm/follow-ups/:id     — done / skip / snooze; CSR cadence
 *                                        re-queues feedback outreach every
 *                                        follow_up_after_days until feedback
 *                                        is recorded
 *   POST   /api/crm/interactions       — log a contact; stamps
 *                                        customers.last_contacted_at and can
 *                                        chain the next follow-up
 *
 * Reads ride GET /api/data (leads/followUps/interactions/feedback slices).
 * All writes publish `job-updated` over SSE so every open portal refreshes.
 */

export const crmRouter = Router();

const isoStamp = z
  .string({ error: 'Required' })
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Use an ISO date-time');

const STAGES = ['Lead', 'Contacted', 'Quoted', 'Negotiation', 'Won', 'Lost'] as const;

// `optionalText` is a bare string schema — it permits an EMPTY value but the key
// itself must still be present. Panes send only the fields they collected (the
// Sales "new client" modal, for one, never collects email or notes), so every
// field the UI may omit carries an explicit `.optional()`.
const leadCreate = z.strictObject({
  name: text,
  contact: optionalText.optional(),
  company: optionalText.optional(),
  phone: optionalText.optional(),
  email: optionalText.optional(),
  stage: z.enum(STAGES).optional(),
  value: money.optional(),
  source: optionalText.optional(),
  nextFollowUpAt: isoStamp.optional(),
  notes: optionalText.optional(),
});

const leadPatch = z.strictObject({
  stage: z.enum(STAGES).optional(),
  value: money.optional(),
  nextFollowUpAt: isoStamp.nullable().optional(),
  notes: optionalText.optional(),
});

const followUpCreate = z.strictObject({
  type: z.enum(['client_follow_up', 'feedback_outreach']),
  customerId: idText.optional(),
  leadId: idText.optional(),
  jobId: idText.optional(),
  dueAt: isoStamp,
  notes: optionalText.optional(),
  followUpAfterDays: z.number().int().min(1).max(90).optional(),
});

const followUpPatch = z.strictObject({
  status: z.enum(['pending', 'done', 'skipped']).optional(),
  dueAt: isoStamp.optional(),
  notes: optionalText.optional(),
  /**
   * CSR cadence: re-queue outreach when done but no feedback yet. 0 closes the
   * loop deliberately (the pane sends 0 when the caller did not ask to be
   * reminded again); omitted falls back to the row's own cadence.
   */
  requeueDays: z.number().int().min(0).max(90).optional(),
});

const interactionCreate = z.strictObject({
  customerId: idText.optional(),
  leadId: idText.optional(),
  jobId: idText.optional(),
  channel: z.enum(['call', 'whatsapp', 'email', 'site', 'other']).optional(),
  notes: text,
  outcome: optionalText.optional(),
  nextFollowUpAt: isoStamp.optional(),
});

/** 403 when the actor's role lacks the capability behind this router. */
/** POST /api/crm/leads — enter a client into the sales workflow. */
crmRouter.post('/leads', requireCapability('handle_leads'), async (req, res) => {
  try {
    const input = parseBody(leadCreate, req.body);
    const id = `ld-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const { rows } = await pool.query(
      `INSERT INTO leads (id, name, contact, company, phone, email, salesperson_id,
                          stage, value, source, next_follow_up_at, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        id,
        input.name,
        input.contact ?? '',
        input.company ?? '',
        input.phone ?? '',
        input.email ?? '',
        // Sales own their list: attribute the lead to whoever enters it.
        req.user?.id ?? null,
        input.stage ?? 'Lead',
        input.value ?? 0,
        input.source ?? 'manual',
        input.nextFollowUpAt ?? null,
        input.notes ?? '',
        req.user?.id ?? null,
      ],
    );
    res.status(201).json({ id: rows[0].id });
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Could not create lead');
  }
});

/** PATCH /api/crm/leads/:id — advance the workflow / set the follow-up time. */
crmRouter.patch('/leads/:id', requireCapability('handle_leads'), async (req, res) => {
  try {
    const input = parseBody(leadPatch, req.body);
    const sets: string[] = [];
    const values: unknown[] = [req.params.id];
    const bind = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (input.stage !== undefined) bind('stage', input.stage);
    if (input.value !== undefined) bind('value', input.value);
    if (input.nextFollowUpAt !== undefined) bind('next_follow_up_at', input.nextFollowUpAt);
    if (input.notes !== undefined) bind('notes', input.notes);
    if (!sets.length) {
      res.status(422).json({ error: 'No fields to update' });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE leads SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      values,
    );
    if (!rows.length) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json({ id: rows[0].id });
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Could not update lead');
  }
});

/** POST /api/crm/follow-ups — schedule a reminder at a date + time. */
crmRouter.post('/follow-ups', requireCapability('handle_leads'), async (req, res) => {
  try {
    const input = parseBody(followUpCreate, req.body);
    const ownerRole = req.user?.role === 'csr' ? 'csr' : 'sales';
    const { rows } = await pool.query(
      `INSERT INTO follow_ups (type, owner_employee_id, owner_role, customer_id, lead_id,
                               job_id, notes, due_at, follow_up_after_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        input.type,
        // Pin the reminder to the person scheduling it; feedback outreach
        // stays a shared queue row when no owner is supplied.
        req.user?.id ?? null,
        ownerRole,
        input.customerId ?? null,
        input.leadId ?? null,
        input.jobId ?? null,
        input.notes ?? '',
        input.dueAt,
        input.followUpAfterDays ?? 2,
      ],
    );
    res.status(201).json({ id: rows[0].id });
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Could not schedule follow-up');
  }
});

/** PATCH /api/crm/follow-ups/:id — complete, skip or snooze a reminder. */
crmRouter.patch('/follow-ups/:id', requireCapability('handle_leads'), async (req, res) => {
  try {
    const input = parseBody(followUpPatch, req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, type, owner_employee_id, owner_role, customer_id, lead_id, job_id,
                notes, status, follow_up_after_days
         FROM follow_ups WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      );
      const row = rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Follow-up not found' });
        return;
      }

      const nextStatus = input.status ?? (input.dueAt !== undefined ? 'pending' : 'done');
      const now = new Date();
      const sets: string[] = [];
      const values: unknown[] = [row.id];
      const bind = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      bind('status', nextStatus);
      if (input.notes !== undefined) bind('notes', input.notes);
      if (nextStatus === 'done') bind('completed_at', now.toISOString());

      // CSR cadence: outreach done but no feedback recorded yet → re-queue
      // every follow_up_after_days (the "every 2 days" rule) so the row comes
      // back on the CSR dashboard until a feedback answer lands.
      let requeued: string | null = null;
      if (nextStatus === 'done' && row.type === 'feedback_outreach') {
        const days = input.requeueDays ?? row.follow_up_after_days ?? 2;
        const hasFeedback = row.job_id
          ? await client.query(`SELECT 1 FROM feedback WHERE job_id = $1 LIMIT 1`, [row.job_id])
          : { rows: [] };
        if (days > 0 && !hasFeedback.rows.length) {
          const dueAt = new Date(now.getTime() + days * 86_400_000).toISOString();
          const queued = await client.query(
            `INSERT INTO follow_ups (type, owner_employee_id, owner_role, customer_id, lead_id,
                                     job_id, notes, due_at, follow_up_after_days)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              row.type,
              row.owner_employee_id,
              row.owner_role,
              row.customer_id,
              row.lead_id,
              row.job_id,
              row.notes,
              dueAt,
              days,
            ],
          );
          requeued = queued.rows[0].id;
        }
      }

      if (input.dueAt !== undefined) bind('due_at', input.dueAt);
      await client.query(`UPDATE follow_ups SET ${sets.join(', ')} WHERE id = $1`, values);

      await client.query('COMMIT');
      res.json({ id: row.id, status: nextStatus, requeued });
    } finally {
      client.release();
    }
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Could not update follow-up');
  }
});

/** POST /api/crm/interactions — log a contact with a client. */
crmRouter.post('/interactions', requireCapability('handle_leads'), async (req, res) => {
  try {
    const input = parseBody(interactionCreate, req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO interactions (customer_id, lead_id, job_id, employee_id, channel,
                                   notes, outcome, next_follow_up_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.customerId ?? null,
          input.leadId ?? null,
          input.jobId ?? null,
          req.user?.id ?? null,
          input.channel ?? 'call',
          input.notes,
          input.outcome ?? '',
          input.nextFollowUpAt ?? null,
        ],
      );

      // Stamp the customer's last contact so CSR "days since" reads stay honest.
      if (input.customerId) {
        await client.query(`UPDATE customers SET last_contacted_at = now() WHERE id = $1`, [
          input.customerId,
        ]);
      }
      // Chain the promised next touch onto the shared reminder queue.
      if (input.nextFollowUpAt && (input.customerId || input.leadId)) {
        await client.query(
          `INSERT INTO follow_ups (type, owner_employee_id, owner_role, customer_id, lead_id,
                                   notes, due_at)
           VALUES ('client_follow_up', $1, $2, $3, $4, $5, $6)`,
          [
            req.user?.id ?? null,
            req.user?.role === 'csr' ? 'csr' : 'sales',
            input.customerId ?? null,
            input.leadId ?? null,
            input.outcome ? `After contact: ${input.outcome}` : 'Follow-up after contact',
            input.nextFollowUpAt,
          ],
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ id: rows[0].id });
    } finally {
      client.release();
    }
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Could not log interaction');
  }
});

function requireCapability(capability: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user && can(req.user.role, capability)) return next();
    res.status(403).json({ error: 'Insufficient capability' });
  };
}
