import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, pickChannels, completionPayload, type Settings } from '../services/notifications';
import { pool } from '../db';
import { migrate } from '../migrate';

// completionPayload builds absolute URLs using APP_BASE_URL; set it for the
// pure tests so invoice_pdf_url and feedback_url resolve against a host.
if (!process.env.APP_BASE_URL) process.env.APP_BASE_URL = 'https://example.com';

// ── Pure tests (no database) ──────────────────────────────────────────────────

test('renderTemplate substitutes {{var}} placeholders', () => {
  const result = renderTemplate('Hello {{customer_name}}, your job {{job_number}} is done.', {
    customer_name: 'Alice',
    job_number: 'JOB-001',
  });
  assert.equal(result, 'Hello Alice, your job JOB-001 is done.');
});

test('renderTemplate leaves unknown variables in place', () => {
  const result = renderTemplate('Hi {{name}}, your {{item}} arrived.', { name: 'Bob' });
  assert.equal(result, 'Hi Bob, your {{item}} arrived.');
});

test('renderTemplate coerces non-string values to strings', () => {
  const result = renderTemplate('Total: {{total}} items: {{count}}', { total: 250000, count: 3 });
  assert.equal(result, 'Total: 250000 items: 3');
});

test('renderTemplate blanks out null and undefined values', () => {
  const result = renderTemplate('A={{a}} B={{b}} C={{c}}', { a: null, b: undefined, c: 0 });
  assert.equal(result, 'A= B= C=0');
});

test('pickChannels prefers WhatsApp when enabled and configured', () => {
  const settings: Settings = {
    company_name: 'Gabfix', company_phone: '', whatsapp_enabled: true, sms_enabled: true,
    email_enabled: true, push_enabled: false, appreciation_delay_hours: 24, feedback_retention_days: 90,
  };
  const channels = pickChannels(settings, true, true, true);
  assert.deepEqual(channels, ['whatsapp', 'inapp']);
});

test('pickChannels falls back to SMS when WhatsApp is not enabled', () => {
  const settings: Settings = {
    company_name: 'Gabfix', company_phone: '', whatsapp_enabled: false, sms_enabled: true,
    email_enabled: true, push_enabled: false, appreciation_delay_hours: 24, feedback_retention_days: 90,
  };
  const channels = pickChannels(settings, true, true, true);
  assert.deepEqual(channels, ['sms', 'email', 'inapp']);
});

test('pickChannels always includes email and inapp when configured', () => {
  const settings: Settings = {
    company_name: 'Gabfix', company_phone: '', whatsapp_enabled: false, sms_enabled: false,
    email_enabled: true, push_enabled: false, appreciation_delay_hours: 24, feedback_retention_days: 90,
  };
  const channels = pickChannels(settings, false, false, true);
  assert.deepEqual(channels, ['email', 'inapp']);
});

test('pickChannels always includes inapp even with no providers', () => {
  const settings: Settings = {
    company_name: 'Gabfix', company_phone: '', whatsapp_enabled: true, sms_enabled: true,
    email_enabled: true, push_enabled: false, appreciation_delay_hours: 24, feedback_retention_days: 90,
  };
  const channels = pickChannels(settings, false, false, false);
  assert.deepEqual(channels, ['inapp']);
});

test('completionPayload produces consistent figures from CompletionData', () => {
  const data = {
    jobNumber: 'JOB-001', customerName: 'Alice', customerPhone: '+256 700 000 001',
    customerEmail: 'alice@example.com', customerOptIn: true, whatsappNumber: '+256 700 000 001',
    serviceName: 'Deep clean', completedAt: new Date('2026-09-27'),
    total: 250000, paid: 100000, balance: 150000, invoiceId: 'inv-001', invoiceNumber: 'INV-001',
    technicianNames: 'Sam',
  };
  const payload = completionPayload(data, 'https://example.com/feedback/abc');
  assert.equal(payload.customer_name, 'Alice');
  assert.equal(payload.service_name, 'Deep clean');
  assert.equal(payload.date, '2026-09-27');
  assert.equal(payload.technician, 'Sam');
  assert.equal(payload.total, '250,000');
  assert.equal(payload.paid, '100,000');
  assert.equal(payload.balance, '150,000');
  assert.equal(payload.invoice_pdf_url, 'https://example.com/api/documents/invoice/inv-001.pdf');
  assert.equal(payload.feedback_url, 'https://example.com/feedback/abc');
});

test('completionPayload handles missing invoice and unknown technician', () => {
  const data = {
    jobNumber: 'JOB-002', customerName: 'Bob', customerPhone: '',
    customerEmail: 'bob@example.com', customerOptIn: false, whatsappNumber: '',
    serviceName: 'Wash', completedAt: new Date('2026-09-27'),
    total: 0, paid: 0, balance: 0, invoiceId: null, invoiceNumber: null, technicianNames: '',
  };
  const payload = completionPayload(data, 'https://example.com/feedback/xyz');
  assert.equal(payload.invoice_pdf_url, '');
  assert.equal(payload.technician, 'our team');
  assert.equal(payload.total, '0');
  assert.equal(payload.feedback_url, 'https://example.com/feedback/xyz');
});

// ── Integration tests (real PostgreSQL; skipped when unreachable) ─────────────
const dbUp = await pool.query('SELECT 1').then(() => true).catch(() => false);

if (dbUp) {
  const client = await pool.connect();
    try { await migrate(client); } finally { client.release(); }

    test('dispatchEvent + processQueued lifecycle', { timeout: 20_000 }, async () => {
    const { dispatchEvent, processQueued, resetSettingsCache } = await import('../services/notifications');
    resetSettingsCache();
    const run = Date.now();
    const customerId = `nt-c-${run}`;
    const jobId = `nt-j-${run}`;
    const serviceId = `nt-s-${run}`;
    const invoiceId = `nt-i-${run}`;

    try {
      // Insert test data (auto-commit so it’s visible to all connections —
      // PostgreSQL MVCC hides uncommitted rows from other clients).
      await pool.query(
        `INSERT INTO customers (id, name, phone, email, balance, status, opt_in, whatsapp_number)
         VALUES ($1, 'Notif Test Ltd', '+256 777 000 222', 'nt@example.com', 0, 'Active', TRUE, '+256777000222')`,
        [customerId],
      );
      await pool.query(`INSERT INTO services (id, name) VALUES ($1, 'Notif Service')`, [serviceId]);
      await pool.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, completed_at, revenue, cost)
         VALUES ($1, $2, $3, $4, '2026-09-27', 'Completed', '2026-09-27', 250000, 100000)`,
        [jobId, `JOB-NT-${run}`, customerId, serviceId],
      );
      await pool.query(
        `INSERT INTO invoices (id, number, customer_id, date, due, total, paid, status, job_id)
         VALUES ($1, $2, $3, '2026-09-27', '2026-09-30', 250000, 0, 'Unpaid', $4)`,
        [invoiceId, `INV-NT-${run}`, customerId, jobId],
      );

      // Dispatch the event (simulating the jobs PATCH handler).
      const dc = await pool.connect();
      try {
        await dispatchEvent(dc, { type: 'job.completed', entityType: 'jobs', entityId: jobId });
      } finally {
        dc.release();
      }

      // Verify a queued inapp notification was created.
      const queued = await pool.query(
        `SELECT id FROM notifications WHERE job_id = $1 AND channel = 'inapp' AND status = 'queued'`,
        [jobId],
      );
      assert.ok(queued.rows.length > 0, 'a queued inapp notification row should exist');

      // Process the queue — the inapp adapter fires via SSE, so status becomes 'read'.
      const sent = await processQueued();
      assert.ok(sent > 0, 'processQueued should send at least one notification');

            const processed = await pool.query(
        `SELECT status FROM notifications WHERE job_id = $1 AND channel = 'inapp' AND template_key = 'job_completion'`,
        [jobId],
      );
      assert.equal(processed.rows[0].status, 'read', 'inapp notifications become read after processing');

      // A feedback request should have been created during dispatch.
      const feedbackReq = await pool.query(`SELECT token FROM feedback_requests WHERE job_id = $1`, [jobId]);
      assert.ok(feedbackReq.rows.length > 0, 'a feedback request should have been created');
        } finally {
      // Clean up so the suite is idempotent across runs.
      await pool.query('DELETE FROM feedback WHERE job_id = $1', [jobId]);
      await pool.query('DELETE FROM feedback_requests WHERE job_id = $1', [jobId]);
      await pool.query('DELETE FROM notifications WHERE job_id = $1', [jobId]);
      await pool.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
      await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
      await pool.query('DELETE FROM services WHERE id = $1', [serviceId]);
      await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
    }
  });

  test('recordFeedback stores a rating and marks the token used', { timeout: 20_000 }, async () => {
    const { createFeedbackRequest, recordFeedback } = await import('../services/notifications');
        const run = Date.now();
    const customerId = `nt-fc-${run}`;
    const jobId = `nt-fj-${run}`;
    const serviceId = `nt-svc-${run}`;

    try {
      // Insert test data (auto-commit so it’s visible to all connections).
      await pool.query(
        `INSERT INTO customers (id, name, phone, email, balance, status, opt_in, whatsapp_number)
         VALUES ($1, 'Feedback Test Ltd', '+256 777 000 333', 'ft@example.com', 0, 'Active', TRUE, '+256777000333')`,
        [customerId],
      );
      await pool.query(`INSERT INTO services (id, name) VALUES ($1, 'Feedback Service')`, [serviceId]);
      await pool.query(
        `INSERT INTO jobs (id, number, customer_id, service_id, date, status, completed_at)
         VALUES ($1, $2, $3, $4, '2026-09-27', 'Completed', '2026-09-27')`,
        [jobId, `JOB-FB-${run}`, customerId, serviceId],
      );

      const dc = await pool.connect();
      try {
        const token = await createFeedbackRequest(dc, 'job', jobId, 'inapp', 90);
        assert.ok(token, 'a feedback token should be returned');

        const ok = await recordFeedback(token, 5, 'Great service!');
        assert.equal(ok, true, 'rating should be recorded');

        const second = await recordFeedback(token, 4, '');
        assert.equal(second, false, 'used token should not be accepted again');
      } finally {
        dc.release();
      }
        } finally {
      // Delete feedback rows first (FK references feedback_requests.token).
      await pool.query('DELETE FROM feedback WHERE job_id = $1', [jobId]);
      await pool.query('DELETE FROM feedback_requests WHERE job_id = $1', [jobId]);
      await pool.query('DELETE FROM notifications WHERE job_id = $1', [jobId]);
      await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
      await pool.query('DELETE FROM services WHERE id = $1', [serviceId]);
      await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
    }
  });
} else {
  test('notifications integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[notifications.test] PostgreSQL unreachable — integration tests skipped');
  });
}

