-- 009_jobs_dates.sql (plan's "004_jobs_dates_assignments.sql", renumbered to
-- the next free file in this repo; Phase 1 data spine — job dates, priority,
-- site and attribution, plus the job event log and per-employee assignments).
--
-- One concern: making job dates and staffing truthful. The legacy `date`
-- column stays (it is the scheduled/execution day the UI edits today); the
-- new columns split the lifecycle into day-level dates (quote, scheduled,
-- promised) and instant timestamps (started, completed, invoiced, paid), add
-- the commercial attribution (salesperson, manager), the work-site address
-- with optional coordinates, and two new tables: job_events (append-only
-- lifecycle log) and job_assignments (who is on the job, in what role).
-- Branchless by design (single shop, plan decision #9).
--
-- Additive only; safe to re-run. Existing rows are backfilled from the
-- legacy `date` column so nothing reads as null where a truth existed.

-- ── New job columns ────────────────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_date DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_date DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS promised_at DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoiced_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salesperson_id UUID REFERENCES employees(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES employees(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'Normal';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS site_address TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS jobs_scheduled_date_idx ON jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS jobs_salesperson_idx ON jobs(salesperson_id) WHERE salesperson_id IS NOT NULL;

-- ── Backfill from the legacy `date` column ────────────────────────────────
-- The old job `date` always meant "the day this job happens".
UPDATE jobs SET scheduled_date = date WHERE scheduled_date IS NULL;
-- Quoted jobs were quoted on their job day in the legacy data.
UPDATE jobs SET quote_date = date WHERE status = 'Quoted' AND quote_date IS NULL;
-- Completed work: start/complete instants are unknown, so pin them to the
-- job's Kampala midday (the same convention the payments service uses for
-- received_at) rather than leaving the timeline permanently blank.
UPDATE jobs SET started_at = date::timestamptz + interval '9 hours'
  WHERE status IN ('Completed', 'In Progress') AND started_at IS NULL;
UPDATE jobs SET completed_at = date::timestamptz + interval '17 hours'
  WHERE status = 'Completed' AND completed_at IS NULL;
-- invoiced_at / paid_at stay null: jobs carry no invoice link historically.

-- ── Job events (append-only lifecycle log) ────────────────────────────────
CREATE TABLE IF NOT EXISTS job_events (
  id BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_employee_id UUID REFERENCES employees(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS job_events_job_idx ON job_events(job_id, at DESC);

-- ── Job assignments (who is on the job) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS job_assignments (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  role TEXT NOT NULL DEFAULT 'technician',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (job_id, employee_id)
);
CREATE INDEX IF NOT EXISTS job_assignments_employee_idx ON job_assignments(employee_id);
