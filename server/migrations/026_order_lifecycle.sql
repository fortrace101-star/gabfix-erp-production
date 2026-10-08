-- 026_order_lifecycle.sql (plan: cleaning-operations-workflow.md, phase P1)
--
-- One concern: the salesperson-created order lifecycle. A proposal is a real
-- statement of intent awaiting phone verification, so it needs its own status
-- plus auditable provenance:
--   * source / proposed_by  — who brought the order in (website vs portal)
--   * confirmed_at/by       — the manager/customer-support phone verification
--   * cancel_reason         — cancellations are audited, never silent
--   * share_token           — tokenised read-only link, safe to paste in
--                             WhatsApp (the salesperson's "share proposal")
--   * share_sent_at         — the manager's queue can see it was shared
--   * closed_at             — a job is "open" until Closed (terminal state)
--
-- `jobs.status` has no CHECK constraint (plain TEXT), so the new stage values
-- are enforced by the server's zod enums; nothing here rewrites existing rows
-- except the additive source backfill. Additive only; safe to re-run.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS proposed_by UUID REFERENCES employees(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES employees(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancel_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS share_token UUID;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS share_sent_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- One constraint for the source vocabulary (plan §5); created after the column
-- so a re-run cannot double-add it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_source_check'
  ) THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_source_check
      CHECK (source IN ('website', 'salesperson', 'admin', 'other'));
  END IF;
END $$;

-- The share link is the job's public handle: unique where present so a token
-- can never resolve to two orders.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_share_token_idx
  ON jobs (share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_proposed_by_idx
  ON jobs (proposed_by) WHERE proposed_by IS NOT NULL;

-- Backfill: jobs attributed to a salesperson came in through the portal.
UPDATE jobs SET source = 'salesperson'
 WHERE salesperson_id IS NOT NULL AND source = 'admin';

-- ── Message templates for the lifecycle events ─────────────────────────────
-- notifications.template_key has no FK, but sendOne() marks a row failed when
-- its template is missing — so seed one body per (key, channel) we dispatch.
INSERT INTO message_templates (key, channel, subject, body, variables, approved) VALUES
  ('order_proposed', 'inapp', NULL,
   'New proposal {{job_number}} — {{customer_name}} · {{service_name}} · {{requested_date}} (from {{proposed_by}})',
   ARRAY['job_number','customer_name','service_name','requested_date','proposed_by'], TRUE),
  ('order_proposed', 'push', NULL,
   'New proposal {{job_number}} — {{customer_name}} from {{proposed_by}}',
   ARRAY['job_number','customer_name','proposed_by'], TRUE),
  ('order_proposed_shared', 'inapp', NULL,
   'Proposal {{job_number}} link shared by {{proposed_by}} — {{customer_name}}',
   ARRAY['job_number','customer_name','proposed_by'], TRUE),
  ('order_confirmed', 'inapp', NULL,
   'Order {{job_number}} confirmed for {{customer_name}} — you''re booked for {{requested_date}}',
   ARRAY['job_number','customer_name','requested_date'], TRUE)
ON CONFLICT (key, channel) DO NOTHING;