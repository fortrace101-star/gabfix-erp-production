-- 025: per-stage job checklists + a job activity log.
--
-- A job carries a checklist for every stage it passes through, starting with
-- "Inspection" when the job is created. Items are editable (add/tick/remove) by
-- the assigned crew, and `job_activities` is the free-text log where work that
-- happened off-system (or was forgotten at handover) can still be captured
-- against the stage it belongs to.

CREATE TABLE IF NOT EXISTS job_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  done_at TIMESTAMPTZ,
  done_by UUID REFERENCES employees(id),
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_checklist_items_job_idx
  ON job_checklist_items (job_id, stage, position, created_at);

CREATE TABLE IF NOT EXISTS job_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  body TEXT NOT NULL,
  employee_id UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_activities_job_idx
  ON job_activities (job_id, created_at DESC);