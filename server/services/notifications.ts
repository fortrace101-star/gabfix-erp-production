/**
 * Notification dispatch and channel adapters (Phase 3, plan §13).
 *
 * Pipeline:
 *   1. A route handler calls `dispatchEvent(client, { type, entityType, entityId })`.
 *   2. dispatchEvent() resolves the event to a template key + audience using
 *      rules in `EVENT_RULES`, creating one `notifications` row per
 *      (audience member, channel) pair.
 *   3. The row stays `queued` until `processQueued()` runs (the server
 *      scheduler, or an explicit flush). processQueued() calls the right
 *      channel adapter, sends, and updates the row's status.
 *   4. Channel adapters are **disabled** when provider credentials are
 *      absent (plan §7: lazy validation). The 'inapp' channel always works
 *      via the SSE bus, so the bell panel updates regardless.
 *
 * The same payload builder feeds every channel so figures never drift
 * between WhatsApp, SMS, email and the PDF (plan §13.3).
 */

import type { PoolClient } from 'pg';
import { pool } from '../db';
import webpush from 'web-push';
import { publish } from './realtime';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { randomBytes } from 'node:crypto';
import { kampalaToday } from '../lib/dates';
export type Channel = 'whatsapp' | 'sms' | 'email' | 'inapp' | 'push';
export type NotificationStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export type DomainEvent =
  | { type: 'job.completed'; entityType: 'jobs'; entityId: string }
  | { type: 'job.created'; entityType: 'jobs'; entityId: string }
  | { type: 'job.assigned'; entityType: 'jobs'; entityId: string }
  | { type: 'payment.recorded'; entityType: 'payments'; entityId: string }
  | { type: 'laundry.ready'; entityType: 'laundry_orders'; entityId: string }
  | { type: 'laundry.collected'; entityType: 'laundry_orders'; entityId: string }
  | { type: 'purchase.approved'; entityType: 'purchase_requests'; entityId: string }
  | { type: 'feedback.received'; entityType: 'feedback'; entityId: string }
  // Order lifecycle (plan P1): proposal created / shared / phone-verified.
  | { type: 'order.proposed'; entityType: 'jobs'; entityId: string }
  | { type: 'order.proposed.shared'; entityType: 'jobs'; entityId: string }
  | { type: 'order.confirmed'; entityType: 'jobs'; entityId: string };

export type NotificationRow = {
  id: string;
  template_key: string;
  channel: Channel;
  customer_id: string | null;
  employee_id: string | null;
  job_id: string | null;
  entity_type: string;
  entity_id: string;
  to_address: string;
  payload: Record<string, string | number>;
  status: NotificationStatus;
  scheduled_for: Date | null;
};

type Audience = {
  customer_id: string | null;
  employee_id: string | null;
  to_address: string;
  /** Pin the channels this recipient accepts (e.g. a synthetic app bell is inapp-only). */
  channels?: Channel[];
};

type TemplateRow = {
  key: string;
  channel: Channel;
  subject: string | null;
  body: string;
  variables: string[];
  approved: boolean;
};

export type Settings = {
  company_name: string;
  company_phone: string;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  /** Opt-in per app: column 'push_enabled' survives resets; default off until
   *  the admin settings UI flips it. */
  push_enabled: boolean;
  appreciation_delay_hours: number;
  feedback_retention_days: number;
};

type SendResult = { ok: true; providerRef?: string } | { ok: false; error: string };

/** Human-readable money for message text. */
const money = (value: number | null | undefined): string =>
  value === null || value === undefined ? '0' : Math.round(value).toLocaleString('en-US');

// ── Template rendering ──────────────────────────────────────────────────────

/**
 * Render `{{var}}` placeholders in a template body using the payload map.
 * Unknown variables are left in place so the message still sends and the
 * gap is visible in logs.
 */
export function renderTemplate(body: string, payload: Record<string, unknown>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in payload)) return `{{${key}}}`;
    const val = payload[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

// ── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_CACHE_TTL_MS = 10_000;
let settingsCache: { data: Settings; at: number } | null = null;

/** Load the one settings row, with a short cache to avoid a query per event. */
export async function loadSettings(client: PoolClient): Promise<Settings> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < SETTINGS_CACHE_TTL_MS) return settingsCache.data;

  const { rows } = await client.query<Settings>("SELECT\r\n    company_name, company_phone,\r\n    COALESCE(whatsapp_enabled, FALSE) AS \"whatsapp_enabled\",\r\n    COALESCE(sms_enabled, FALSE) AS \"sms_enabled\",\r\n    COALESCE(email_enabled, FALSE) AS \"email_enabled\",\r\n    COALESCE(appreciation_delay_hours, 24) AS \"appreciation_delay_hours\",\r\n    COALESCE(feedback_retention_days, 90) AS \"feedback_retention_days\"\r\n    FROM settings WHERE id = 1");
  if (!rows.length) {
    const defaults: Settings = {
      company_name: 'Gabfix', company_phone: '', whatsapp_enabled: false, sms_enabled: false,
      email_enabled: false, push_enabled: false, appreciation_delay_hours: 24, feedback_retention_days: 90,
    };
    settingsCache = { data: defaults, at: now };
    return defaults;
  }
  settingsCache = { data: rows[0], at: now };
  return rows[0];
}

/** Test hook: drop the settings cache so tests see fresh data. */
export function resetSettingsCache(): void {
  settingsCache = null;
}

/** Resolve whether a channel is operational (toggle + credentials). */
function channelEnabled(settings: Settings, channel: Channel): boolean {
  switch (channel) {
    case 'whatsapp': return settings.whatsapp_enabled && !!process.env.WHATSAPP_ACCESS_TOKEN;
    case 'sms': return settings.sms_enabled && !!process.env.AT_API_KEY;
    case 'email': return settings.email_enabled && !!process.env.SMTP_HOST;
    case 'inapp': return true;
    default: return false;
  }
}

/** Clear the credentials check for testing (force channels on/off). */
export function _isChannelEnabled(settings: Settings, channel: Channel): boolean {
  return channelEnabled(settings, channel);
}

/** Reset credentials-based channel selection: prefer WhatsApp, then SMS, email, inapp. */
export function pickChannels(settings: Settings, hasWhatsApp: boolean, hasSms: boolean, hasEmail: boolean): Channel[] {
  const channels: Channel[] = [];
  if (settings.whatsapp_enabled && hasWhatsApp) {
    channels.push('whatsapp');
  } else {
    if (settings.sms_enabled && hasSms) channels.push('sms');
    if (settings.email_enabled && hasEmail) channels.push('email');
  }
  // Push is opt-in per app via the server settings toggle; when enabled it
  // rides alongside the in-app bell (plan §F2: all four apps delivered).
  if (settings.push_enabled) channels.push('push');
  channels.push('inapp');
  return channels;
}

// ── Completion payload ──────────────────────────────────────────────────────

/** Shape of the completion message data (plan §13.3). */
export type CompletionData = {
  jobNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerOptIn: boolean;
  whatsappNumber: string;
  serviceName: string;
  completedAt: Date;
  total: number;
  paid: number;
  balance: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  technicianNames: string;
};

/**
 * Load all data the completion message needs from a job row:
 * customer (phone, email, opt-in, WhatsApp), service, invoice + payments,
 * and the team that completed the job.
 *
 * The job must already be completed (completed_at is set) — the dispatcher
 * fires this event from the PATCH handler when status transitions to Completed.
 */
export async function loadCompletionData(client: PoolClient, jobId: string): Promise<CompletionData | null> {
  const { rows } = await client.query<{
    number: string; customer_name: string; customer_phone: string; customer_email: string;
    customer_opt_in: boolean; whatsapp_number: string; service_name: string;
    completed_at: Date; total: number; paid: number; balance: number;
    invoice_id: string | null; invoice_number: string | null; assignee_names: string;
  }>(
    `SELECT j.number, c.name AS customer_name, c.phone AS customer_phone,
            c.email AS customer_email, c.opt_in AS customer_opt_in,
            COALESCE(c.whatsapp_number, '') AS whatsapp_number,
            s.name AS service_name, j.completed_at,
            COALESCE(j.revenue, 0)::float8 AS total,
            COALESCE(inv.paid, 0)::float8 AS paid,
            COALESCE(inv.total, 0)::float8 - COALESCE(inv.paid, 0) AS balance,
            inv.id AS invoice_id, inv.number AS invoice_number,
            COALESCE(string_agg(e.name, ', ' ORDER BY e.name), '') AS assignee_names
     FROM jobs j
     JOIN customers c ON c.id = j.customer_id
     JOIN services s ON s.id = j.service_id
     LEFT JOIN invoices inv ON inv.id = (
       SELECT id FROM invoices WHERE job_id = j.id ORDER BY created_at DESC LIMIT 1
     )
     LEFT JOIN job_assignments ja ON ja.job_id = j.id
     LEFT JOIN employees e ON e.id = ja.employee_id
     WHERE j.id = $1
     GROUP BY j.id, j.number, c.name, c.phone, c.email, c.opt_in, c.whatsapp_number,
              s.name, j.completed_at, inv.id, inv.number, inv.total, inv.paid`,
    [jobId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    jobNumber: r.number,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    customerOptIn: r.customer_opt_in,
    whatsappNumber: r.whatsapp_number,
    serviceName: r.service_name,
    completedAt: r.completed_at,
    total: r.total,
    paid: r.paid,
    balance: r.balance,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    technicianNames: r.assignee_names,
  };
}

/**
 * Build the template-variable payload from completion data.
 * The same map feeds email, SMS, WhatsApp and the PDF attachment generator,
 * so figures can never drift between channels (plan §13.3).
 */
export function completionPayload(data: CompletionData, feedbackUrl: string): Record<string, unknown> {
  return {
    customer_name: data.customerName,
    service_name: data.serviceName,
    date: data.completedAt ? data.completedAt.toISOString().slice(0, 10) : kampalaToday(),
    technician: data.technicianNames || 'our team',
    subtotal: money(data.total),
    total: money(data.total),
    paid: money(data.paid),
    balance: money(data.balance),
    invoice_pdf_url: data.invoiceId
      ? `${process.env.APP_BASE_URL || ''}/api/documents/invoice/${data.invoiceId}.pdf`
      : '',
    feedback_url: feedbackUrl,
  };
}

// ── Event dispatch ──────────────────────────────────────────────────────────

type EventRule = {
  templateKey: string;
  channel: Channel;
  /** Resolve recipients for this event inside the caller's transaction. */
  audience: Audience[] | ((client: PoolClient, event: DomainEvent) => Promise<Audience[]>);
  /** Build the per-recipient payload (template variables). */
  payload: (client: PoolClient, event: DomainEvent) => Promise<Record<string, unknown>>;
  /** Optional: schedule the notification for the future (e.g. appreciation). */
  scheduledFor?: (settings: Settings) => Date | null;
};

/** Resolve audience for a job.completion event. */
async function completionAudience(client: PoolClient, event: DomainEvent): Promise<Audience[]> {
  const data = await loadCompletionData(client, event.entityId);
  if (!data) return [];
  const toAddress = data.customerEmail || data.customerPhone;
  if (!toAddress) return [];
  return [{
    customer_id: null, // resolved via job.customer_id in dispatchEvent
    employee_id: null,
    to_address: toAddress,
  }];
}

/** Resolve the customer_id for a job's audience (needed for opt-in checks). */
async function customerForJob(client: PoolClient, jobId: string): Promise<{ id: string; opt_in: boolean; whatsapp_number: string; phone: string; email: string; name: string } | null> {
  const { rows } = await client.query<{ id: string; opt_in: boolean; whatsapp_number: string; phone: string; email: string; name: string }>(
    `SELECT id, opt_in, COALESCE(whatsapp_number, '') AS "whatsapp_number", phone, email, name FROM customers WHERE id = (SELECT customer_id FROM jobs WHERE id = $1)`,
    [jobId],
  );
  return rows[0] ?? null;
}

/** Resolve audience for an appreciation event (same customer, 24h later). */
async function appreciationAudience(client: PoolClient, event: DomainEvent): Promise<Audience[]> {
  const data = await loadCompletionData(client, event.entityId);
  if (!data) return [];
  const toAddress = data.customerEmail || data.customerPhone;
  if (!toAddress) return [];
  return [{ customer_id: null, employee_id: null, to_address: toAddress }];
}

/**
 * Rules mapping a domain event to (template, channel, audience, payload).
 * Each rule produces notification rows for the resolved channels.
 */
/** Synthetic audiences: rows addressed to a whole app (F2 scoped bells). */
const STORE_BELL: Audience[] = [{ customer_id: null, employee_id: null, to_address: 'app:store' }];
const ADMIN_BELL: Audience[] = [{ customer_id: null, employee_id: null, to_address: 'app:admin' }];

export const EVENT_RULES: Record<DomainEvent['type'], EventRule[]> = {
  'job.completed': [
    {
      templateKey: 'job_completion',
      channel: 'inapp',
      audience: completionAudience,
      payload: async (client, event) => {
        const data = await loadCompletionData(client, event.entityId);
        if (!data) return {};
        const token = await createFeedbackRequest(client, 'job', event.entityId, 'inapp', 90);
        return completionPayload(data, `${process.env.APP_BASE_URL || ''}/feedback/${token}`);
      },
    },
    {
      templateKey: 'job_appreciation',
      channel: 'inapp',
      audience: appreciationAudience,
      payload: async (client, event) => {
        const data = await loadCompletionData(client, event.entityId);
        if (!data) return {};
        return { customer_name: data.customerName };
      },
      scheduledFor: (settings) => new Date(Date.now() + settings.appreciation_delay_hours * 3600 * 1000),
    },
    {
      templateKey: 'job_completion',
      channel: 'push',
      audience: STORE_BELL,
      payload: async (client, event) => {
        const data = await loadCompletionData(client, event.entityId);
        if (!data) return {};
        const token = await createFeedbackRequest(client, 'job', event.entityId, 'push', 90);
        return completionPayload(data, `${process.env.APP_BASE_URL || ''}/feedback/${token}`);
      },
    },
  ],
  'job.created': [],
  'payment.recorded': [],
  'laundry.ready': [
    {
      templateKey: 'laundry_ready',
      channel: 'inapp',
      audience: laundryReadyAudience,
      payload: laundryReadyPayload,
    },
    {
      templateKey: 'laundry_ready',
      channel: 'push',
      audience: ADMIN_BELL,
      payload: laundryReadyPayload,
    },
  ],
  'laundry.collected': [],
  // Plan v5 F: cross-app push via the same fabric. These rules use the
  // synthetic app bells + the push channel (plan §F1/F2: all four apps
  // delivered, bell-only surface). Dispatch is unchanged — the same rows
  // are produced; only the channel set differs per recipient.
  'job.assigned': [
    // The assignee's own bell (plan F3: job.assigned → portal bell): one
    // employee-scoped row per crew member so GET /notifications/unread?
    // scope=portal&employeeId= surfaces it in the portal's task list.
    {
      templateKey: 'job_assigned',
      channel: 'inapp',
      audience: assigneeAudience,
      payload: jobAssignedPayload,
    },
    {
      templateKey: 'job_assigned',
      channel: 'push',
      audience: STORE_BELL,
      payload: jobAssignedPayload,
    },
  ],
  'purchase.approved': [
    {
      templateKey: 'purchase_approved',
      channel: 'push',
      audience: ADMIN_BELL,
      payload: purchaseApprovedPayload,
    },
  ],
  'feedback.received': [
    {
      templateKey: 'feedback_received',
      channel: 'push',
      audience: ADMIN_BELL,
      payload: feedbackReceivedPayload,
    },
  ],
  // ── Order lifecycle (plan P1) ─────────────────────────────────────────────
  'order.proposed': [
    // The manager's Console bell: a new proposal is waiting for verification.
    {
      templateKey: 'order_proposed',
      channel: 'inapp',
      audience: [{ ...ADMIN_BELL[0], channels: ['inapp'] }],
      payload: orderLifecyclePayload,
    },
    // Push to the manager as well (skipped rows when VAPID is not configured).
    {
      templateKey: 'order_proposed',
      channel: 'push',
      audience: [{ ...ADMIN_BELL[0], channels: ['push'] }],
      payload: orderLifecyclePayload,
    },
    // The proposer + customer support see it land in their portal bells.
    {
      templateKey: 'order_proposed',
      channel: 'inapp',
      audience: proposalAudience,
      payload: orderLifecyclePayload,
    },
  ],
  'order.proposed.shared': [
    // "Link appears in the manager's queue" (plan §8 matrix).
    {
      templateKey: 'order_proposed_shared',
      channel: 'inapp',
      audience: [{ ...ADMIN_BELL[0], channels: ['inapp'] }],
      payload: orderLifecyclePayload,
    },
  ],
  'order.confirmed': [
    // Phone verification done — tell the salesperson their proposal landed.
    {
      templateKey: 'order_confirmed',
      channel: 'inapp',
      audience: proposerAudience,
      payload: orderLifecyclePayload,
    },
  ],
};


async function laundryReadyAudience(client: PoolClient, event: DomainEvent): Promise<Audience[]> {
  const { rows } = await client.query<{ phone: string; email: string }>(
    `SELECT COALESCE(c.phone, '') AS phone, COALESCE(c.email, '') AS email
     FROM laundry_orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
    [event.entityId],
  );
  if (!rows.length) return [];
  const audiences: Audience[] = [];
  // The customer hears on every channel they have an address for.
  const customerAddress = rows[0].phone || rows[0].email || '';
  if (customerAddress) {
    audiences.push({ customer_id: null, employee_id: null, to_address: customerAddress });
  }
  // …and the admin console rings its bell (plan F3: laundry.ready → admin).
  audiences.push({ customer_id: null, employee_id: null, to_address: 'app:admin', channels: ['inapp'] });
  return audiences;
}

async function laundryReadyPayload(client: PoolClient, event: DomainEvent): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{ number: string; customer_name: string | null; total: number }>(
    `SELECT o.number, o.total::float8 AS total, c.name AS customer_name
     FROM laundry_orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
    [event.entityId],
  );
  if (!rows.length) return {};
  const r = rows[0];
  return {
    order_number: r.number,
    customer_name: r.customer_name ?? 'the customer',
    total: money(r.total),
  };
}

async function assigneeAudience(client: PoolClient, event: DomainEvent): Promise<Audience[]> {
  const { rows } = await client.query<{ employee_id: string; name: string }>(
    `SELECT a.employee_id::text AS employee_id, e.name
     FROM job_assignments a JOIN employees e ON e.id = a.employee_id
     WHERE a.job_id = $1`,
    [event.entityId],
  );
  return rows.map((r) => ({ customer_id: null, employee_id: r.employee_id, to_address: r.name, channels: ['inapp'] as const }));
}

async function jobAssignedPayload(client: PoolClient, event: DomainEvent): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{ number: string; customer_name: string | null; service_name: string | null; scheduled: string | null; address: string | null }>(
    `SELECT j.number, c.name AS customer_name, s.name AS service_name,
            j.scheduled_date::text AS scheduled, j.site_address AS address
     FROM jobs j
     LEFT JOIN customers c ON c.id = j.customer_id
     LEFT JOIN services s ON s.id = j.service_id
     WHERE j.id = $1`,
    [event.entityId],
  );
  if (!rows.length) return {};
  const r = rows[0];
  return {
    job_number: r.number,
    customer_name: r.customer_name ?? 'a customer',
    service_name: r.service_name ?? '',
    scheduled: r.scheduled ?? '',
    address: r.address ?? '',
  };
}

async function purchaseApprovedPayload(client: PoolClient, event: DomainEvent): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{ description: string; qty: number; value: number; requested_by: string; item_name: string | null }>(
    `SELECT p.description, p.qty::float8 AS qty, p.value::float8 AS value, p.requested_by,
            i.name AS item_name
     FROM purchase_requests p LEFT JOIN inventory_items i ON i.id = p.item_id
     WHERE p.id = $1`,
    [event.entityId],
  );
  if (!rows.length) return {};
  const r = rows[0];
  return {
    item: r.item_name ?? r.description,
    qty: r.qty,
    value: money(r.value),
    requested_by: r.requested_by,
  };
}

async function feedbackReceivedPayload(client: PoolClient, event: DomainEvent): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{ rating: number; comment: string; customer_name: string | null; job_number: string | null }>(
    `SELECT f.rating::float8 AS rating, f.comment, c.name AS customer_name, j.number AS job_number
     FROM feedback f
     LEFT JOIN customers c ON c.id = f.customer_id
     LEFT JOIN jobs j ON j.id = f.job_id
     WHERE f.id = $1`,
    [event.entityId],
  );
  if (!rows.length) return {};
  const r = rows[0];
  return {
    rating: r.rating,
    customer_name: r.customer_name ?? 'A customer',
    job_number: r.job_number ?? '',
    comment: (r.comment || '').slice(0, 140),
  };
}

/** Payload for the order-lifecycle events (plan §8: order.proposed / confirmed). */
async function orderLifecyclePayload(client: PoolClient, event: DomainEvent): Promise<Record<string, unknown>> {
  const { rows } = await client.query<{
    number: string; customer_name: string | null; service_name: string | null;
    date: string; proposed_by_name: string | null;
  }>(
    `SELECT j.number, c.name AS customer_name, s.name AS service_name,
            j.date::text AS date, e.name AS proposed_by_name
     FROM jobs j
     LEFT JOIN customers c ON c.id = j.customer_id
     LEFT JOIN services s ON s.id = j.service_id
     LEFT JOIN employees e ON e.id = j.proposed_by
     WHERE j.id = $1`,
    [event.entityId],
  );
  if (!rows.length) return {};
  const r = rows[0];
  return {
    job_number: r.number,
    customer_name: r.customer_name ?? 'a customer',
    service_name: r.service_name ?? '',
    requested_date: r.date ?? '',
    proposed_by: r.proposed_by_name ?? 'the team',
  };
}

/**
 * order.proposed audience: the salesperson who created it (confirmation their
 * proposal landed) plus every customer-support employee — the two portal
 * roles that pick proposals up. Pinned to inapp (same pattern as
 * assigneeAudience): dispatchEvent fans out on the picked channel set, not
 * rule.channel.
 */
async function proposalAudience(client: PoolClient, event: DomainEvent): Promise<Audience[]> {
  const { rows: jobRows } = await client.query<{ proposed_by: string | null; proposed_by_name: string | null }>(
    `SELECT j.proposed_by::text AS proposed_by, e.name AS proposed_by_name
     FROM jobs j LEFT JOIN employees e ON e.id = j.proposed_by
     WHERE j.id = $1`,
    [event.entityId],
  );
  const { rows: staff } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM employees
      WHERE role = 'csr' AND active AND deleted_at IS NULL`,
  );
  const audience: Audience[] = staff.map((s) => ({
    customer_id: null, employee_id: s.id, to_address: s.name, channels: ['inapp'],
  }));
  const proposer = jobRows[0];
  if (proposer?.proposed_by && !staff.some((s) => s.id === proposer.proposed_by)) {
    audience.push({
      customer_id: null,
      employee_id: proposer.proposed_by,
      to_address: proposer.proposed_by_name ?? proposer.proposed_by,
      channels: ['inapp'],
    });
  }
  return audience;
}

/** order.confirmed audience: the person who proposed it ("you're booked"). */
async function proposerAudience(client: PoolClient, event: DomainEvent): Promise<Audience[]> {
  const { rows } = await client.query<{ proposed_by: string | null; proposed_by_name: string | null }>(
    `SELECT j.proposed_by::text AS proposed_by, e.name AS proposed_by_name
     FROM jobs j LEFT JOIN employees e ON e.id = j.proposed_by
     WHERE j.id = $1`,
    [event.entityId],
  );
  const job = rows[0];
  if (!job?.proposed_by) return [];
  return [{
    customer_id: null,
    employee_id: job.proposed_by,
    to_address: job.proposed_by_name ?? job.proposed_by,
    channels: ['inapp'],
  }];
}

/**
 * Dispatch a domain event into notification rows. Must run inside the caller's
 * transaction (the caller owns the connection). After rows are inserted, the
 * scheduler's `processQueued()` sends them asynchronously.
 */
export async function dispatchEvent(client: PoolClient, event: DomainEvent): Promise<void> {
  const settings = await loadSettings(client);
  const rules = EVENT_RULES[event.type];
  if (!rules || !rules.length) return;

  const hasWhatsApp = !!process.env.WHATSAPP_ACCESS_TOKEN;
  const hasSms = !!process.env.AT_API_KEY;
  const hasEmail = !!process.env.SMTP_HOST;

  for (const rule of rules) {
    const audiences = Array.isArray(rule.audience) ? rule.audience : await rule.audience(client, event);
    const basePayload = await rule.payload(client, event);

    for (const audience of audiences) {
      // Resolve customer for opt-in + WhatsApp number checks.
      let resolvedCustomerId: string | null = audience.customer_id;
      // Synthetic app-bell rows keep customer/employee NULL so the scoped
      // bell queries (F2) can match them on to_address alone.
      const syntheticBell = audience.to_address.startsWith('app:');
      // Synthetic app bells (F2) and push recipients are not attached to a
      // customer/employee, so resolvedCustomerId stays NULL (they are
      // surfaced by scoped bell queries and push send, not by customer_id).
      let customer: { opt_in: boolean; whatsapp_number: string } | null = null;
      if (event.type === 'job.completed' || event.type === 'job.created' || event.type === 'job.assigned') {
        const c = await customerForJob(client, event.entityId);
        if (c) {
          customer = { opt_in: c.opt_in, whatsapp_number: c.whatsapp_number };
          // Job audiences leave customer_id null — backfill so the bell panel
          // (which filters by customer_id) can surface the notification.
          resolvedCustomerId = audience.customer_id ?? c.id;
        }
      }
      const picked = pickChannels(settings, hasWhatsApp, hasSms, hasEmail);
      // Synthetic or pinned audiences restrict their own channel set; the
      // channelEnabled check below still records 'skipped' rows for the rest.
      const channelList = audience.channels ?? picked;

      const scheduledFor = rule.scheduledFor ? rule.scheduledFor(settings) : null;

      for (const channel of channelList) {
        if (((event.type === 'laundry.ready' || event.type === 'laundry.collected') && !syntheticBell) || channel === 'push') {
          const lr = await client.query<{ customer_id: string | null }>(
            `SELECT customer_id FROM laundry_orders WHERE id = $1`,
            [event.entityId],
          );
          resolvedCustomerId = resolvedCustomerId ?? lr.rows[0]?.customer_id ?? null;
        }
        if (!channelEnabled(settings, channel)) {
          await client.query(
            `INSERT INTO notifications
               (template_key, channel, customer_id, employee_id, job_id, entity_type, entity_id,
                to_address, payload, status, scheduled_for, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'skipped', $10, 'Channel credentials not configured')
             ON CONFLICT (template_key, channel, entity_type, entity_id, to_address)
             WHERE notifications.status <> 'failed' DO NOTHING`,
            [
              rule.templateKey, channel,
              resolvedCustomerId, audience.employee_id,
              event.entityType === 'jobs' ? event.entityId : null,
              event.entityType, event.entityId, audience.to_address,
              JSON.stringify(basePayload), scheduledFor,
            ],
          );
          continue;
        }

        // For WhatsApp, skip if the customer hasn't opted in.
        if (channel === 'whatsapp' && customer && !customer.opt_in) continue;

        await client.query(
          `INSERT INTO notifications
             (template_key, channel, customer_id, employee_id, job_id, entity_type, entity_id,
              to_address, payload, scheduled_for)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (template_key, channel, entity_type, entity_id, to_address)
           WHERE notifications.status <> 'failed' DO NOTHING`,
          [
            rule.templateKey, channel,
            resolvedCustomerId, audience.employee_id,
            event.entityType === 'jobs' ? event.entityId : null,
            event.entityType, event.entityId, audience.to_address,
            JSON.stringify(basePayload), scheduledFor,
          ],
        );
      }
    }
  }
}

// ── Feedback tokens ────────────────────────────────────────────────────────

const FEEDBACK_TOKEN_BYTES = 32;

/**
 * Create a single-use, expiring feedback-request token for a job.
 * Links the token to the entity so the public form has everything it needs
 * (plan §13.4). Safe to re-run: ON CONFLICT DO NOTHING on the token.
 */
export async function createFeedbackRequest(
  client: PoolClient,
  entityType: 'job' | 'laundry_order',
  entityId: string,
  channel: Channel = 'email',
  ttlDays: number = 90,
): Promise<string> {
  const token = randomBytes(FEEDBACK_TOKEN_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 3600_000);
  const entityCol = entityType === 'job' ? 'job_id' : 'laundry_order_id';

  await client.query(
    `INSERT INTO feedback_requests (token, ${entityCol}, channel, message_sent_at, expires_at)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (token) DO NOTHING`,
    [token, entityId, channel, expiresAt],
  );

  // Backfill customer_id from the entity so the feedback form can show
  // "feedback from {{customer_name}}".
  await client.query(
    `UPDATE feedback_requests SET customer_id = e.customer_id
     FROM ${entityType === 'job' ? 'jobs' : 'laundry_orders'} e
     WHERE feedback_requests.${entityCol} = e.id
       AND feedback_requests.customer_id IS NULL`,
  );

  return token;
}

/** Look up a valid (unused, unexpired) feedback token. */
export async function getFeedbackRequest(token: string): Promise<{
  token: string; job_id: string | null; laundry_order_id: string | null; customer_id: string | null;
  expires_at: Date | null; used_at: Date | null;
} | null> {
  const { rows } = await pool.query(
    `SELECT token, job_id, laundry_order_id, customer_id, expires_at, used_at
     FROM feedback_requests WHERE token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

/** Record a rating against a feedback token (single-use: mark used). */
export async function recordFeedback(
  token: string,
  rating: number,
  comment: string,
  employeeIds: string[] = [],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fr = await client.query(
      `SELECT id, job_id, customer_id FROM feedback_requests
       WHERE token = $1 AND used_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [token],
    );
    if (!fr.rows.length) { await client.query('ROLLBACK'); return false; }
    const req = fr.rows[0];
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO feedback (token, job_id, customer_id, rating, comment, employee_ids, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'web') RETURNING id`,
      [token, req.job_id, req.customer_id, rating, comment, employeeIds],
    );
    await client.query(`UPDATE feedback_requests SET used_at = NOW(), rating = $1, comment = $2 WHERE token = $3`, [rating, comment, token]);
    // Ring the admin bell (plan v5 F3: feedback.received → admin).
    if (inserted.rows[0]) {
      await dispatchEvent(client, { type: 'feedback.received', entityType: 'feedback', entityId: inserted.rows[0].id });
    }
    await client.query('COMMIT');
    return true;
  } catch {
    await client.query('ROLLBACK');
    return false;
    } finally {
    client.release();
  }
}

// ── Channel adapters ────────────────────────────────────────────────────────

/** In-app adapter: push over SSE so the bell panel updates live. */
function inappAdapter(_payload: Record<string, unknown>, _toAddress: string): SendResult {
  try {
        publish({ type: 'notification' });
    return { ok: true, providerRef: 'sse' };
  } catch {
    return { ok: true, providerRef: 'sse' };
  }
}

/** Push adapter: send a VAPID push to a subscription's service worker. Disabled
 *  when VAPID credentials are absent (lazy validation, plan §F4.2). */
async function pushAdapter(
  payload: Record<string, unknown>,
  toAddress: string,
): Promise<SendResult> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { ok: false, error: 'VAPID keys not configured' };
  }
  try {
    const subscription = JSON.parse(toAddress) as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'admin@gabfix.local'}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    const options = {
      TTL: 24 * 60 * 60, // 24h delivery window
      subject: 'mailto:admin@gabfix.local',
    };
    await webpush.sendNotification(subscription, JSON.stringify(payload), options);
    return { ok: true, providerRef: subscription.endpoint };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('404') || message.includes('Not Found') || message.includes('Unsubscription')) {
      return { ok: false, error: 'Subscription no longer valid' };
    }
    return { ok: false, error: message };
  }
}

/** Email adapter: SMTP via nodemailer. */
async function emailAdapter(
  template: TemplateRow,
  payload: Record<string, unknown>,
  toAddress: string,
): Promise<SendResult> {
  if (!process.env.SMTP_HOST) return { ok: false, error: 'SMTP_HOST not configured' };
  try {
    const transporter: Transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || 'no-reply@gabfix.local',
      to: toAddress,
      subject: template.subject || 'Gabfix notification',
      text: renderTemplate(template.body, payload),
    });
    return { ok: true, providerRef: info.messageId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** SMS adapter: Africa's Talking REST API via fetch. */
async function smsAdapter(
  payload: Record<string, unknown>,
  toAddress: string,
  renderedBody: string,
): Promise<SendResult> {
  if (!process.env.AT_API_KEY || !process.env.AT_USERNAME) {
    return { ok: false, error: "Africa's Talking not configured" };
  }
  try {
    const res = await fetch('https://api.africastalking.com/v1/messaging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.AT_API_KEY },
      body: JSON.stringify({
        username: process.env.AT_USERNAME,
        to: toAddress,
        message: renderedBody,
        from: process.env.AT_SENDER_ID || undefined,
      }),
    });
    const result = await res.json().catch(() => ({})) as { SMSMessageData?: { Message?: string; Recipients?: Array<{ messageId?: string }> } };
    if (!res.ok) return { ok: false, error: result.SMSMessageData?.Message || `HTTP ${res.status}` };
    return { ok: true, providerRef: result.SMSMessageData?.Recipients?.[0]?.messageId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** WhatsApp adapter: Meta Graph API. Disabled when credentials absent. */
async function whatsappAdapter(
  template: TemplateRow,
  payload: Record<string, unknown>,
  toAddress: string,
): Promise<SendResult> {
  if (!process.env.WHATSAPP_ACCESS_TOKEN) return { ok: false, error: 'WhatsApp token not configured' };
  try {
    const phone = toAddress.startsWith('+') ? toAddress : `+${toAddress}`;
    const apiVersion = process.env.WHATSAPP_GRAPH_VERSION || '20.0';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const templateName = process.env.WHATSAPP_TEMPLATE_JOB_DONE || 'job_done';

    const res = await fetch(
      `https://graph.facebook.com/v${apiVersion}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: phone, type: 'template',
          template: {
            name: templateName,
            language: { code: 'en' },
            components: [{
              type: 'body',
              parameters: (template.variables.length ? template.variables : Object.keys(payload)).map((key) => {
                const v = payload[key as keyof typeof payload] ?? '';
                return typeof v === 'number'
                  ? { type: 'number', number: String(v) }
                  : { type: 'text', text: String(v) };
              }),
            }],
          },
        }),
      },
    );
        const result = await res.json().catch(() => ({})) as { error?: { message: string }; messages?: Array<{ id: string }> };
    if (!res.ok) return { ok: false, error: result.error?.message || `HTTP ${res.status}` };
    return { ok: true, providerRef: result.messages?.[0]?.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────

/**
 * Process all `queued` notifications whose scheduled_for is in the past.
 * Runs each channel adapter; updates the row to sent/failed.
 *
 * Called by the server scheduler (or explicit flush). Isolated per
 * notification so one failure doesn't block the rest.
 */
export async function processQueued(limit = 20): Promise<number> {
  const client = await pool.connect();
  let sent = 0;
  try {
    const { rows } = await client.query<NotificationRow>(
      `SELECT * FROM notifications
       WHERE status = 'queued' AND (scheduled_for IS NULL OR scheduled_for <= NOW())
       ORDER BY created_at LIMIT $1`,
      [limit],
    );
            for (const row of rows) {
      try {
        await client.query('BEGIN');
        const ok = await sendOne(client, row);
        await client.query('COMMIT');
        if (ok) sent++;
      } catch {
        await client.query('ROLLBACK');
      }
    }
  } finally {
    client.release();
  }
  return sent;
}

/** Send a single notification row using the right adapter. */
async function sendOne(client: PoolClient, row: NotificationRow): Promise<boolean> {
  const { rows: tRows } = await client.query<TemplateRow>(
    `SELECT key, channel, subject, body, variables, approved FROM message_templates WHERE key = $1 AND channel = $2`,
    [row.template_key, row.channel],
  );
  const template = tRows[0];
  if (!template) {
    await client.query(`UPDATE notifications SET status = 'failed', error = 'Template not found' WHERE id = $1`, [row.id]);
    return false;
  }

  // WhatsApp requires approved templates.
  if (row.channel === 'whatsapp' && !template.approved) {
    await client.query(`UPDATE notifications SET status = 'skipped', error = 'Template not approved' WHERE id = $1`, [row.id]);
    return false;
  }

  const payload = row.payload as unknown as Record<string, unknown>;
  const renderedBody = renderTemplate(template.body, payload);
  let result: SendResult;
  switch (row.channel) {
    case 'inapp': result = inappAdapter(payload, row.to_address); break;
    case 'email': result = await emailAdapter(template, payload, row.to_address); break;
    case 'sms': result = await smsAdapter(payload, row.to_address, renderedBody); break;
    case 'whatsapp': result = await whatsappAdapter(template, payload, row.to_address); break;
    case 'push': result = await pushAdapter(payload, row.to_address); break;
    default: result = { ok: false, error: `Unknown channel ${row.channel}` };
  }

  if (result.ok) {
    await client.query(
      `UPDATE notifications SET status = $1, provider_ref = $2, sent_at = NOW(), attempts = attempts + 1 WHERE id = $3`,
      [row.channel === 'inapp' ? 'read' : row.channel === 'push' ? 'sent' : 'sent', result.providerRef ?? null, row.id],
    );
    return true;
  } else {
    await client.query(
      `UPDATE notifications SET status = 'failed', error = $1, attempts = attempts + 1 WHERE id = $2`,
      [result.error, row.id],
    );
    return false;
  }
}

// ── Bell panel queries ──────────────────────────────────────────────────────

export type BellNotification = {
  id: string;
  template_key: string;
  channel: Channel;
  entity_type: string;
  entity_id: string;
  status: NotificationStatus;
  payload: Record<string, unknown>;
  created_at: Date;
};

export type BellScope = 'admin' | 'laundry' | 'portal' | 'store';

/** Which synthetic bell each app listens to; `admin` also sees customer rows. */
const SCOPE_TO_ADDRESS: Record<BellScope, string> = {
  admin: 'app:admin',
  laundry: 'app:laundry',
  portal: 'app:portal',
  store: 'app:store',
};

/**
 * Unread in-app notifications for a bell panel (plan v5 F2).
 *
 * `customerId` surfaces customer-addressed rows (completion messages, …);
 * `employeeId` surfaces rows assigned to the logged-in staff member
 * (job.assigned); `scope` adds the app-addressed synthetic bell so each
 * console only sees the events that concern it (purchase.approved → store,
 * feedback.received → admin).`sinceId`/`limit` keep the panel cheap.
 */
export async function unreadNotifications(
  customerId: string,
  options: { employeeId?: string; scope?: BellScope; since?: string; limit?: number } = {},
): Promise<BellNotification[]> {
  const params: unknown[] = [];
  const ors: string[] = [];
  if (customerId) {
    params.push(customerId);
    ors.push(`customer_id = $${params.length}`);
  }
  if (options.employeeId) {
    params.push(options.employeeId);
    ors.push(`employee_id = $${params.length}::uuid`);
  }
  if (options.scope) {
    params.push(SCOPE_TO_ADDRESS[options.scope]);
    ors.push(`(employee_id IS NULL AND customer_id IS NULL AND to_address = $${params.length})`);
  }
  let where = ors.length ? `(${ors.join(' OR ')})` : 'FALSE';
  where += ` AND status IN ('queued','sent','delivered','read') AND read_at IS NULL`;
  if (options.since) {
    params.push(options.since);
    where += ` AND created_at > $${params.length}::timestamptz`;
  }
  params.push(Math.min(Math.max(options.limit ?? 50, 1), 100));
  const { rows } = await pool.query<BellNotification>(
    `SELECT id, template_key, channel, entity_type, entity_id, status, payload, created_at
     FROM notifications WHERE ${where}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Mark a notification as read (bell panel click). */
export async function markNotificationRead(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET status = 'read', read_at = NOW() WHERE id = $1 AND read_at IS NULL`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

/** Mark every notification visible to one bell (customer/employee/app) as read. */
export async function markAllNotificationsRead(
  options: { customerId?: string; employeeId?: string; scope?: BellScope } = {},
): Promise<number> {
  const params: unknown[] = [];
  const ors: string[] = [];
  if (options.customerId) {
    params.push(options.customerId);
    ors.push(`customer_id = $${params.length}`);
  }
  if (options.employeeId) {
    params.push(options.employeeId);
    ors.push(`employee_id = $${params.length}::uuid`);
  }
  if (options.scope) {
    params.push(SCOPE_TO_ADDRESS[options.scope]);
    ors.push(`(employee_id IS NULL AND customer_id IS NULL AND to_address = $${params.length})`);
  }
  if (!ors.length) return 0;
  const { rowCount } = await pool.query(
    `UPDATE notifications SET status = 'read', read_at = NOW()
     WHERE (${ors.join(' OR ')}) AND status IN ('queued','sent','delivered') AND read_at IS NULL`,
    params,
  );
  return rowCount ?? 0;
}

/** Health-check: report which channels are operational. */
export async function channelStatus(settings: Settings): Promise<Record<Channel, boolean>> {
  return {
    whatsapp: _isChannelEnabled(settings, 'whatsapp'),
    sms: _isChannelEnabled(settings, 'sms'),
    email: _isChannelEnabled(settings, 'email'),
    inapp: true,
    push: _isChannelEnabled(settings, 'push'),
  };
}