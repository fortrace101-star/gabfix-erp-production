-- 007_sync_outbox.sql
-- Offline sync plumbing for the laundry front office (multi-app-plan §6, §10.1;
-- migration numbered 007 in this repo's sequence — the plan's "011" slot):
--   * sync_outbox — durable record of every queued offline mutation, keyed by
--     idempotency_key so a retried push can never apply twice.
--   * feedback_requests — Phase 3 will deliver the WhatsApp feedback link here;
--     the table lands now so the sync contract is stable.
-- The laundry PWA's Dexie outbox references these rows by idempotency_key and
-- prunes its local copies once the server ACKs (server stays permanent).

CREATE TABLE IF NOT EXISTS sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  app_scope TEXT NOT NULL CHECK (app_scope IN ('admin','laundry','portal','store')),
  op_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected')),
  error TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sync_outbox_status_idx ON sync_outbox (status, received_at);

DROP TRIGGER IF EXISTS sync_outbox_touch ON sync_outbox;
CREATE TRIGGER sync_outbox_touch BEFORE UPDATE ON sync_outbox
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS feedback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT REFERENCES customers(id),
  laundry_order_id TEXT REFERENCES laundry_orders(id),
  job_id TEXT REFERENCES jobs(id),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  token TEXT NOT NULL UNIQUE,
  message_sent_at TIMESTAMPTZ,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  deleted_at TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS feedback_requests_touch ON feedback_requests;
CREATE TRIGGER feedback_requests_touch BEFORE UPDATE ON feedback_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
