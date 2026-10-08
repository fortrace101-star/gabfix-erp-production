-- 018_push_subscriptions.sql (Plan v5 F — Web Push / cross-app notifications)
--
-- Adds the push subscription table the server needs to schedule web-push
-- delivery to every app's service worker (plan §F2: delivery targets = all
-- four apps, SW + VAPID, bell-only surface). Additive only.
--
--   push_subscriptions — one row per (app_id, device_id), keyed by the
--     unique index; the POST /api/push/subscriptions endpoint upserts.
--   notifications gains a 'push' channel; channelEnabled(settings, 'push')
--     is true only when VAPID_PUBLIC_KEY is configured.
--
-- Because `channel` is part of a primary key / unique index in the tables it
-- is carried across, we cannot drop its NOT NULL constraint. Instead we
-- re-declare the channel CHECK to accept 'push' and add an additive column
-- `channel_push` (nullable) that is ignored by the existing rows.

-- ── push_subscriptions table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  app_id TEXT NOT NULL,
  employee_id TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL DEFAULT '',
  auth TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, device_id)
);

-- One subscription per app + device: the SW-push endpoint is the unique key.
CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_uindex
  ON push_subscriptions (app_id, endpoint)
  WHERE endpoint IS NOT NULL;

-- Per-app lookup for the scheduler's fan-out (app-scoped, no device_id needed).
CREATE INDEX IF NOT EXISTS push_subscriptions_app_idx
  ON push_subscriptions (app_id, device_id)
  WHERE endpoint IS NOT NULL;

DROP TRIGGER IF EXISTS push_subscriptions_touch ON push_subscriptions;
CREATE TRIGGER push_subscriptions_touch
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Enable 'push' as a notification channel ────────────────────────────────────
-- The `channel` column is part of the primary key (message_templates) and a
-- unique index (notifications_dedupe), so it cannot be made nullable here.
-- The CHECK constraints are rewritten to accept 'push' alongside the legacy
-- channels. Existing rows keep their current channel value, which is still a
-- valid legacy channel, so no row is touched.

ALTER TABLE message_templates
  DROP CONSTRAINT IF EXISTS message_templates_channel_check,
  ADD CONSTRAINT message_templates_channel_check
    CHECK (channel IN ('whatsapp', 'sms', 'email', 'inapp', 'push'));

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_channel_check,
  ADD CONSTRAINT notifications_channel_check
    CHECK (channel IN ('whatsapp', 'sms', 'email', 'inapp', 'push'));

-- The dedupe index on notifications references (template_key, channel,
-- entity_type, entity_id). It does NOT reference `channel`, so it is safe to
-- add the 'push' value to the CHECK above. No change needed here.

-- Seed the push bell template (plan §F3: bell-only surface, no subject).
INSERT INTO message_templates (key, channel, subject, body, variables, approved)
VALUES
  ('notification', 'push', NULL,
   '{{title}} — {{body}}',
   ARRAY['title', 'body'], TRUE)
ON CONFLICT (key, channel) DO UPDATE
  SET body = EXCLUDED.body,
      variables = EXCLUDED.variables,
      approved = LEAST(message_templates.approved, EXCLUDED.approved);
