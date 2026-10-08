-- 015_telemetry.sql (Phase 4 — Field operations: GPS tracking, geofences)
--
-- Adds the telemetry data model per plan §6.3 and §010_telemetry.sql:
--   * location_pings     — raw GPS pings from the /field PWA beacon or hardware
--   * location_daily_rollups — per-day summary + trail geometry for replay
--   * geofences          — site boundaries with radius and active flag
--
-- Additive only (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS); safe to re-run.
-- Branchless by design (single shop, plan decision #9).

-- ── Location pings (raw GPS traces) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS location_pings (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices(id),
  employee_id UUID REFERENCES employees(id),
  job_id TEXT REFERENCES jobs(id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m REAL,
  speed_kmh REAL,
  heading REAL,
  battery SMALLINT,
  source TEXT NOT NULL DEFAULT 'pwa',
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS location_pings_device_recorded_idx
  ON location_pings (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS location_pings_job_idx
  ON location_pings (job_id, recorded_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS location_pings_received_idx
  ON location_pings (received_at DESC);

-- Retention policy: raw pings older than 90 days are pruned by a nightly job
-- (plan §14.2: "confirm pings older than the retention window are gone").
-- The rollups survive indefinitely for trail replay.

-- ── Daily rollups (summarised trail per device per day) ─────────────────────
CREATE TABLE IF NOT EXISTS location_daily_rollups (
  device_id UUID NOT NULL,
  day DATE NOT NULL,
  first_at TIMESTAMPTZ,
  last_at TIMESTAMPTZ,
  distance_km NUMERIC,
  max_speed_kmh REAL,
  points INTEGER,
  trail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, day)
);

CREATE INDEX IF NOT EXISTS location_daily_rollups_day_idx
  ON location_daily_rollups (day DESC);

-- ── Geofences (site boundaries) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'site',
        branch_id TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 150,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS geofences_active_idx
  ON geofences (active) WHERE active;
CREATE INDEX IF NOT EXISTS geofences_branch_idx
  ON geofences (branch_id) WHERE branch_id IS NOT NULL;

-- ── Audit triggers ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS location_daily_rollups_touch ON location_daily_rollups;
CREATE TRIGGER location_daily_rollups_touch BEFORE UPDATE ON location_daily_rollups
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS geofences_touch ON geofences;
CREATE TRIGGER geofences_touch BEFORE UPDATE ON geofences
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
