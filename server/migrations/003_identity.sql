-- 003_identity.sql
-- Identity and roles: employees (with a role constraint), and devices — the
-- company numbers issued to field staff that Phase 4 will track (plan 8.2).
-- uuid keys; gen_random_uuid() is core in PostgreSQL 13+.
-- created_by stays TEXT (no self-reference). Additive only.

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','sales','technician','laundry','accountant','csr')),
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  pin_hash TEXT,
  branch_id TEXT REFERENCES branches(id),
  hourly_rate NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  hired_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  msisdn TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'phone',
  employee_id UUID REFERENCES employees(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  installed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  deleted_at TIMESTAMPTZ
);

DROP TRIGGER IF EXISTS employees_touch ON employees;
CREATE TRIGGER employees_touch BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS devices_touch ON devices;
CREATE TRIGGER devices_touch BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
