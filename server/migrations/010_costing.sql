-- 010_costing.sql (plan's "006_costing.sql", renumbered to the next free file
-- in this repo; Phase 1 data spine — job costing).
--
-- One concern: making jobs.cost come from real cost lines. cost_categories
-- classify spend (each pointing at its GL account from 008); suppliers hold
-- who material and subcontract costs are owed to; job_costs are the lines
-- themselves (a material issue, a subcontract, an approved timesheet); 
-- timesheets record field hours that cost the job at the employee's rate.
--
-- jobs.cost recompute rule (payments service pattern): once a job has at
-- least one cost line, the lines own the number (service recomputes
-- jobs.cost = SUM(job_costs.amount) after every write); jobs without lines
-- keep their legacy estimate, per the plan's "keep the old values visible
-- until the ledger is accepted" note on legacy data quality.
--
-- Additive only; safe to re-run.

-- ── Suppliers ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

INSERT INTO suppliers (id, name, phone, notes) VALUES
  ('sup1', 'Kampala Hardware Ltd',  '+256 772 330 118', 'Cleaning equipment and fittings'),
  ('sup2', 'CleanPro Supplies UG',  '+256 701 552 904', 'Chemicals and PPE')
ON CONFLICT (id) DO NOTHING;

-- ── Cost categories ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  gl_account_code TEXT REFERENCES chart_of_accounts(code),
  kind TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'indirect')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

INSERT INTO cost_categories (id, name, gl_account_code, kind) VALUES
  ('cat-materials',    'Materials',    '5000', 'direct'),
  ('cat-labour',       'Labour',       '5000', 'direct'),
  ('cat-subcontract',  'Subcontract',  '5000', 'direct'),
  ('cat-transport',    'Transport',    '6000', 'indirect'),
  ('cat-other',        'Other',        '6000', 'indirect')
ON CONFLICT (id) DO NOTHING;

-- ── Timesheets (field hours) ─────────────────────────────────────────────
-- Created before job_costs, whose timesheet_id references it.
CREATE TABLE IF NOT EXISTS timesheets (
  id BIGSERIAL PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id),
  job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  minutes INT,
  rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  approved_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at > started_at)
);

-- ── Job costs (the lines) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_costs (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES cost_categories(id),
  description TEXT NOT NULL DEFAULT '',
  qty DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (qty >= 0),
  unit_cost DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  amount DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (amount >= 0),
  supplier_id TEXT REFERENCES suppliers(id),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'timesheet', 'inventory', 'import')),
  timesheet_id BIGINT REFERENCES timesheets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES employees(id)
);
CREATE INDEX IF NOT EXISTS job_costs_job_idx ON job_costs(job_id);
-- One cost line per timesheet: approving a timesheet twice must not double-cost.
CREATE UNIQUE INDEX IF NOT EXISTS job_costs_timesheet_ux ON job_costs(timesheet_id) WHERE timesheet_id IS NOT NULL;

-- Keep updated_at honest on every table the runner touches.
DROP TRIGGER IF EXISTS suppliers_touch ON suppliers;
CREATE TRIGGER suppliers_touch BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS cost_categories_touch ON cost_categories;
CREATE TRIGGER cost_categories_touch BEFORE UPDATE ON cost_categories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS timesheets_touch ON timesheets;
CREATE TRIGGER timesheets_touch BEFORE UPDATE ON timesheets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
