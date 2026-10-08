-- 014_notifications.sql (Phase 3 — Notifications, feedback and real-time)
--
-- One concern: the messaging layer that "closes the loop with customers".
-- Adds the tables the dispatch pipeline needs:
--   * settings       — one workspace settings row (company profile, currency,
--                      provider toggles). Replaces localStorage so toggles are
--                      shared across staff and survive backups (plan §8.3, §13).
--   * message_templates — approved template bodies keyed by channel; the
--                      dispatcher resolves a domain event to one of these.
--   * notifications  — durable row per send, with the dedupe index that makes
--                      "never send the same message twice" a DB guarantee.
--   * feedback       — rating rows linked to a feedback_requests token.
--   * feedback_requests gains expires_at + used_at so tokens can expire and
--                      be single-use.
--   * customers gains opt_in + whatsapp_number (plan §8.4 column additions).
--
-- Additive only (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS); safe to re-run.
-- Branchless by design (single shop, plan decision #9).

-- ── Settings: one row per workspace ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT 'Gabfix',
  company_tagline TEXT NOT NULL DEFAULT '',
  company_phone TEXT NOT NULL DEFAULT '',
  company_address TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'UGX',
  tax_basis TEXT NOT NULL DEFAULT 'exclusive',
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  appreciation_delay_hours INTEGER NOT NULL DEFAULT 24,
    feedback_retention_days INTEGER NOT NULL DEFAULT 90,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure the single-row invariant holds even if someone inserts id=2.
CREATE UNIQUE INDEX IF NOT EXISTS settings_single_row ON settings ((TRUE)) WHERE id = 1;

INSERT INTO settings (id, company_name, company_tagline, company_phone)
  VALUES (1, 'Gabfix', 'Cleaning, laundry and facility services', '+256 700 000 000')
ON CONFLICT (id) DO NOTHING;

-- ── Message templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_templates (
  key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','email','inapp')),
  locale TEXT NOT NULL DEFAULT 'en',
  subject TEXT,
  body TEXT NOT NULL,
  variables TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, channel)
);

-- Seed the templates the completion + appreciation pipeline uses. These are
-- body text only — the actual WhatsApp/SMS provider template NAMES go in
-- WHATSAPP_TEMPLATE_JOB_DONE / WHATSAPP_TEMPLATE_APPRECIATION (env). The seed
-- here gives an editable English body for email and a fallback SMS length.
-- `approved = FALSE` until a human reviews; the dispatcher still queues them
-- but WhatsApp sends will be skipped until Meta signs them off.
INSERT INTO message_templates (key, channel, subject, body, variables, approved) VALUES
  ('job_completion', 'email', 'Your service is complete',
   '{{customer_name}}, your {{service_name}} on {{date}} has been completed by {{technician}}. Subtotal: {{total}}. Paid: {{paid}}. Balance: {{balance}}. Invoice: {{invoice_pdf_url}} Feedback: {{feedback_url}}',
   ARRAY['customer_name','service_name','date','technician','total','paid','balance','invoice_pdf_url','feedback_url'], FALSE),
  ('job_completion', 'sms', NULL,
   '{{customer_name}}, {{service_name}} completed {{date}} by {{technician}}. Total {{total}}, paid {{paid}}, balance {{balance}}. Feedback: {{feedback_url}}',
   ARRAY['customer_name','service_name','date','technician','total','paid','balance','feedback_url'], FALSE),
  ('job_appreciation', 'email', 'Thank you for choosing Gabfix',
   '{{customer_name}}, we hope {{service_name}} on {{date}} met expectations. Your feedback helps us improve: {{feedback_url}}',
   ARRAY['customer_name','service_name','date','feedback_url'], FALSE),
    ('job_appreciation', 'sms', NULL,
   'Thank you, {{customer_name}}! How was {{service_name}} on {{date}}? Rate us: {{feedback_url}}',
   ARRAY['customer_name','service_name','date','feedback_url'], FALSE),
  -- in-app templates: always approved (no external provider to sign off).
  ('job_completion', 'inapp', NULL,
   '{{customer_name}}, your {{service_name}} on {{date}} has been completed. Balance: {{balance}}. Feedback: {{feedback_url}}',
   ARRAY['customer_name','service_name','date','balance','feedback_url'], TRUE),
  ('job_appreciation', 'inapp', NULL,
   'Thank you, {{customer_name}}! How was {{service_name}} on {{date}}? Rate us: {{feedback_url}}',
   ARRAY['customer_name','service_name','date','feedback_url'], TRUE)
ON CONFLICT (key, channel) DO UPDATE
    SET subject = EXCLUDED.subject,
      body = EXCLUDED.body,
      variables = EXCLUDED.variables,
      approved = LEAST(message_templates.approved, EXCLUDED.approved);

-- ── Notifications: durable row per send ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','sms','email','inapp')),
  customer_id TEXT REFERENCES customers(id),
  employee_id UUID REFERENCES employees(id),
  job_id TEXT REFERENCES jobs(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  to_address TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'queued'
  CHECK (status IN ('queued','sent','delivered','read','failed','skipped')),
  provider_ref TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe: same template + channel + entity never sends twice, unless the
-- previous attempt failed (partial index lets retries through).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe
  ON notifications (template_key, channel, entity_type, entity_id)
  WHERE status <> 'failed';
CREATE INDEX IF NOT EXISTS notifications_status_sched_idx
  ON notifications (status, scheduled_for) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS notifications_customer_idx
  ON notifications (customer_id) WHERE status IN ('queued','sent','delivered','read');

-- Backfill updated_at for databases created before this column was added.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── Feedback (ratings linked to a token) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT REFERENCES feedback_requests(token),
  job_id TEXT REFERENCES jobs(id),
  customer_id TEXT REFERENCES customers(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'web',
  employee_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_token_idx ON feedback(token);
CREATE INDEX IF NOT EXISTS feedback_job_idx ON feedback(job_id) WHERE job_id IS NOT NULL;

-- Backfill updated_at for databases created before this column was added.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── feedback_requests: add expires_at + used_at to the table from 007 ───────
ALTER TABLE feedback_requests
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- ── Invoices: link back to the job so completionPayload can resolve them ─────
-- loadCompletionData joins invoices→jobs via invoices.job_id.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES jobs(id);
CREATE INDEX IF NOT EXISTS invoices_job_idx ON invoices(job_id) WHERE job_id IS NOT NULL;

-- ── Customers: opt-in flags + WhatsApp number ────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_number TEXT NOT NULL DEFAULT '';

-- Keep updated_at honest on every new table.
DROP TRIGGER IF EXISTS settings_touch ON settings;
CREATE TRIGGER settings_touch BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS message_templates_touch ON message_templates;
CREATE TRIGGER message_templates_touch BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS notifications_touch ON notifications;
CREATE TRIGGER notifications_touch BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS feedback_touch ON feedback;
CREATE TRIGGER feedback_touch BEFORE UPDATE ON feedback FOR EACH ROW EXECUTE FUNCTION touch_updated_at();