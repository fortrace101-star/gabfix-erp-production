-- Plan v5 F3: per-recipient dedupe for notifications.
--
-- The 014 dedupe index (template_key, channel, entity_type, entity_id)
-- assumed one recipient per event. Rules added in F3 address several
-- audiences for one event (laundry.ready → customer AND admin bell), and
-- the ON CONFLICT clause silently dropped every audience after the first.
-- Adding to_address keeps the single-send guarantee per recipient while
-- letting distinct recipients each get their row.

DROP INDEX IF EXISTS notifications_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe
  ON notifications (template_key, channel, entity_type, entity_id, to_address)
  WHERE status <> 'failed';
