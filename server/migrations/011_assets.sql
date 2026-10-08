-- 011_assets.sql (plan's "007_assets.sql", renumbered to the next free file
-- in this repo; Phase 1 data spine — asset register with depreciation).
--
-- One concern: making equipment a real asset register. The columns from the
-- plan's section 15.4 turn the hand-typed book value into a computed figure
-- (cost − accumulated depreciation); asset_depreciation_entries is the
-- schedule — one posting per asset per period, unique so a period can never
-- be double-depreciated.
--
-- The two GL accounts follow the plan's chart-of-accounts ranges (15.3):
-- 1400/1500 in the 1000–1999 asset block, 6100 in the 6000–6999 expense
-- block. Seeding them here keeps the money spine (008) and the asset spine
-- (011) independent: 011 re-runs even on a database without 008.
--
-- Additive only; safe to re-run.

-- ── GL accounts for depreciation postings ──────────────────────────────────
INSERT INTO chart_of_accounts (code, name, type) VALUES
  ('1400', 'Equipment at cost',             'asset'),
  ('1500', 'Accumulated depreciation',      'asset'),
  ('6100', 'Depreciation expense',          'expense')
ON CONFLICT (code) DO NOTHING;

-- ── Asset register columns on equipment ────────────────────────────────────
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS purchase_date DATE,
  ADD COLUMN IF NOT EXISTS cost NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salvage_value NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS useful_life_months INT,
  ADD COLUMN IF NOT EXISTS depreciation_method TEXT NOT NULL DEFAULT 'straight-line'
    CHECK (depreciation_method IN ('straight-line', 'none')),
  ADD COLUMN IF NOT EXISTS accumulated_depreciation NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disposed_at DATE,
  ADD COLUMN IF NOT EXISTS custodian_employee_id UUID REFERENCES employees(id);

-- Backfill: cost from the seeded value, purchase date unknown → the job's
-- Kampala epoch so the schedule has a stable start. book_value stays the
-- source of truth until the first schedule posting takes over (same
-- "legacy values visible until the ledger is accepted" rule as jobs.cost).
UPDATE equipment
SET cost = value,
    purchase_date = COALESCE(purchase_date, DATE '2026-01-01')
WHERE cost = 0;

-- ── Depreciation schedule (one posting per asset per period) ───────────────
CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
  id BIGSERIAL PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  accumulated NUMERIC NOT NULL DEFAULT 0 CHECK (accumulated >= 0),
  book_value NUMERIC NOT NULL DEFAULT 0 CHECK (book_value >= 0),
  posted_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (equipment_id, period)
);
CREATE INDEX IF NOT EXISTS asset_depreciation_equipment_idx ON asset_depreciation_entries(equipment_id);

-- Keep updated_at honest on the table the runner touches.
DROP TRIGGER IF EXISTS asset_depreciation_entries_touch ON asset_depreciation_entries;
CREATE TRIGGER asset_depreciation_entries_touch BEFORE UPDATE ON asset_depreciation_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
