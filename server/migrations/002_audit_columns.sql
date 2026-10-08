-- 002_audit_columns.sql
-- Audit columns and a shared touch trigger on every pre-existing table
-- (plan section 8.6). created_by stays TEXT until identity lands in 003;
-- reads keep selecting explicit columns, so GET /api/data shape is unchanged.
-- Additive only and safe to re-run.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'customers', 'services', 'jobs', 'invoices',
    'expenses', 'laundry_orders', 'equipment', 'inventory_items'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches', 'customers', 'services', 'jobs', 'invoices',
    'expenses', 'laundry_orders', 'equipment', 'inventory_items'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
                   t || '_touch', t);
  END LOOP;
END $$;
