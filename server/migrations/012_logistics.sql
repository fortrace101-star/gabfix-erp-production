-- 012_logistics.sql (plan's "008_logistics.sql", renumbered to the next free
-- file in this repo; Phase 1 data spine — laundry logistics).
--
-- One concern: making laundry orders flow through time. promised_at / 
-- ready_at / collected_at turn the status label into a timeline the laundry
-- front office can promise against and report on; job_id links a laundry run
-- to the job that covers it; weight_kg and pieces price per-kg versus
-- per-piece intake. laundry_order_items is the line-level breakdown the
-- free-text items column can't price.
--
-- Branchless by decision #9: the plan's 008 also added branch_id, but
-- branches were removed in 006 (orders already belong to the one business).
--
-- Lifecycle stamps are derived from status transitions in the route, never
-- written by the client — the jobs pattern from 009.
--
-- Additive only; safe to re-run.

-- ── Laundry order logistics columns ────────────────────────────────────────
ALTER TABLE laundry_orders
  ADD COLUMN IF NOT EXISTS promised_at DATE,
  ADD COLUMN IF NOT EXISTS ready_at DATE,
  ADD COLUMN IF NOT EXISTS collected_at DATE,
  ADD COLUMN IF NOT EXISTS job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pieces INT NOT NULL DEFAULT 0;

-- Backfill the seeded timeline: a Collected order was ready when it was
-- collected and both happened on the received day in the demo data (same
-- pinned-backfill approach as 009's lifecycle timestamps).
UPDATE laundry_orders
SET ready_at = COALESCE(ready_at, received),
    collected_at = COALESCE(collected_at, received)
WHERE status IN ('Ready', 'Collected') AND (ready_at IS NULL OR collected_at IS NULL);

-- ── Line items (the priced breakdown) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS laundry_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id),
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC NOT NULL DEFAULT 1 CHECK (qty >= 0),
  unit TEXT NOT NULL DEFAULT 'item',
  unit_price NUMERIC NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS laundry_order_items_order_idx ON laundry_order_items(order_id);

-- Keep updated_at honest on the tables the runner touches.
DROP TRIGGER IF EXISTS laundry_order_items_touch ON laundry_order_items;
CREATE TRIGGER laundry_order_items_touch BEFORE UPDATE ON laundry_order_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
