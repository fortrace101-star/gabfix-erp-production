-- 005_multiapp_identity.sql
-- Multi-app identity (multi-app-plan §10.1, Phase 0c):
--   * employees.app_scope TEXT[] — which of the four apps the employee may use
--     ('admin', 'laundry', 'portal', 'store'). Copied into JWTs at login and
--     enforced by requireScope() in middleware/auth.ts.
--   * role CHECK extended with 'storekeeper' (Gabfix Store's operator role).
--   * The owner is the control-plane super user: all four scopes.
-- Additive and idempotent; existing roles keep working unchanged.

-- 1. Widen the role constraint (003 created it inline, so look up its name).
DO $$
DECLARE
  conname_text TEXT;
BEGIN
  SELECT c.conname INTO conname_text
  FROM pg_constraint c
  WHERE c.conrelid = 'employees'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%role%IN%'
  LIMIT 1;

  IF conname_text IS NOT NULL THEN
    EXECUTE format('ALTER TABLE employees DROP CONSTRAINT %I', conname_text);
  END IF;
END $$;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;

ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('owner','manager','sales','technician','laundry','accountant','storekeeper'));

-- 2. App scopes: which apps each employee may sign in to.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS app_scope TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_app_scope_check;
ALTER TABLE employees ADD CONSTRAINT employees_app_scope_check
  CHECK (app_scope <@ ARRAY['admin','laundry','portal','store']::TEXT[]);

-- 3. Backfill from role (plan §10.1): owner keeps the control plane, managers
--    and accountants admin + store, sales/technicians the portal, laundry the
--    laundry front office. Owner then gets all four regardless.
UPDATE employees SET app_scope = ARRAY['admin']::TEXT[]
WHERE role = 'owner' AND app_scope = ARRAY[]::TEXT[];

UPDATE employees SET app_scope = ARRAY['admin','store']::TEXT[]
WHERE role IN ('manager','accountant') AND app_scope = ARRAY[]::TEXT[];

UPDATE employees SET app_scope = ARRAY['portal']::TEXT[]
WHERE role IN ('sales','technician') AND app_scope = ARRAY[]::TEXT[];

UPDATE employees SET app_scope = ARRAY['laundry']::TEXT[]
WHERE role = 'laundry' AND app_scope = ARRAY[]::TEXT[];

UPDATE employees SET app_scope = ARRAY['store']::TEXT[]
WHERE role = 'storekeeper' AND app_scope = ARRAY[]::TEXT[];

UPDATE employees SET app_scope = ARRAY['admin','laundry','portal','store']::TEXT[]
WHERE role = 'owner';

-- 4. There is exactly one control-plane owner; a partial unique index makes
--    that a database guarantee, not a convention.
CREATE UNIQUE INDEX IF NOT EXISTS employees_single_owner
  ON employees ((TRUE)) WHERE role = 'owner' AND deleted_at IS NULL;
