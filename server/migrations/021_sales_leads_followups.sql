-- 021_sales_leads_followups.sql (Role dashboards — Sales/CSR data spine)
--
-- Adds the tables the role-driven portal dashboards read:
--   * customers — salesperson attribution + last contact stamp, so a sales
--                 person's "clients I brought in" and "revenue from my clients"
--                 are one join away (decision B1: acquisition stays on the
--                 customer row; the pipeline itself lives in `leads`).
--   * leads     — the client-acquisition workflow (Lead → Contacted → Quoted →
--                 Negotiation → Won/Lost) with a TIMESTAMP next-follow-up
--                 (decision B3: a real time, not a derived day count).
--   * follow_ups— shared reminder queue for Sales client follow-ups AND the
--                 CSR feedback-outreach cadence (1–2 days, every 2 days after
--                 a job completes with no feedback recorded).
--   * interactions — the CSR/sales interaction log shown on the dashboards.
--
-- Additive only (IF NOT EXISTS); safe to re-run. Branchless (single shop).
-- Audit columns (created_at/updated_at/created_by/deleted_at) + the
-- updated_at touch trigger come along for every new table (002 contract).

-- ── Customers: attribution + contact stamp ───────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS source_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS customers_salesperson_idx
  ON customers(salesperson_id) WHERE salesperson_id IS NOT NULL;

-- ── Leads: the acquisition workflow per sales person ─────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  salesperson_id UUID REFERENCES employees(id),
  stage TEXT NOT NULL DEFAULT 'Lead'
    CHECK (stage IN ('Lead','Contacted','Quoted','Negotiation','Won','Lost')),
  value NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  -- Decision B3: when (date + time) the sales person must follow up. The
  -- dashboard highlights it and the bell reminds them the moment it is due.
  next_follow_up_at TIMESTAMPTZ,
  converted_customer_id TEXT REFERENCES customers(id),
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS leads_salesperson_idx
  ON leads(salesperson_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_stage_idx
  ON leads(stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_follow_up_idx
  ON leads(next_follow_up_at) WHERE deleted_at IS NULL AND next_follow_up_at IS NOT NULL;

-- ── Follow-ups: the shared reminder queue (Sales + CSR) ──────────────────────
CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('client_follow_up','feedback_outreach')),
  -- Unowned rows are a shared queue (e.g. outreach for "any CSR"); an
  -- owner_employee_id pins the reminder to one person's dashboard.
  owner_employee_id UUID REFERENCES employees(id),
  owner_role TEXT NOT NULL CHECK (owner_role IN ('sales','csr')),
  customer_id TEXT REFERENCES customers(id),
  lead_id TEXT REFERENCES leads(id),
  job_id TEXT REFERENCES jobs(id),
  notes TEXT NOT NULL DEFAULT '',
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  -- CSR cadence: re-check every N days after an attempt until feedback lands.
  follow_up_after_days INTEGER NOT NULL DEFAULT 2,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS follow_ups_owner_due_idx
  ON follow_ups(owner_role, due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS follow_ups_owner_emp_idx
  ON follow_ups(owner_employee_id, due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS follow_ups_due_idx
  ON follow_ups(due_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS follow_ups_job_idx
  ON follow_ups(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS follow_ups_lead_idx
  ON follow_ups(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS follow_ups_customer_idx
  ON follow_ups(customer_id) WHERE customer_id IS NOT NULL;

-- ── Interactions: what was said, when, and what happens next ─────────────────
CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT REFERENCES customers(id),
  lead_id TEXT REFERENCES leads(id),
  job_id TEXT REFERENCES jobs(id),
  employee_id UUID REFERENCES employees(id),
  channel TEXT NOT NULL DEFAULT 'call' CHECK (channel IN ('call','whatsapp','email','site','other')),
  notes TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  next_follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interactions_customer_idx ON interactions(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS interactions_lead_idx ON interactions(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS interactions_created_idx ON interactions(created_at DESC);

-- Keep updated_at honest (002 contract).
DROP TRIGGER IF EXISTS leads_touch ON leads;
CREATE TRIGGER leads_touch BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS follow_ups_touch ON follow_ups;
CREATE TRIGGER follow_ups_touch BEFORE UPDATE ON follow_ups FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS interactions_touch ON interactions;
CREATE TRIGGER interactions_touch BEFORE UPDATE ON interactions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── Seed: CSR feedback outreach for completed jobs with no feedback yet ──────
-- Cadence: due 1 day after completion, then re-checked every 2 days until a
-- feedback row exists (the CSR dashboard consumes owner_role = 'csr').
INSERT INTO follow_ups (type, owner_role, customer_id, job_id, due_at, follow_up_after_days, notes)
SELECT 'feedback_outreach', 'csr', j.customer_id, j.id,
       j.completed_at + INTERVAL '1 day', 2,
       'Feedback check-in for ' || j.number || ' (completed ' || j.completed_at::date || ')'
FROM jobs j
WHERE j.completed_at IS NOT NULL
  AND j.customer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM feedback f WHERE f.job_id = j.id)
  AND NOT EXISTS (
    SELECT 1 FROM follow_ups fu
    WHERE fu.job_id = j.id AND fu.type = 'feedback_outreach'
  );

