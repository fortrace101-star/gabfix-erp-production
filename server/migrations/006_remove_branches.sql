-- 006_remove_branches.sql
-- Single-shop conversion (multi-app-plan decision #9: "we don't have branches,
-- remove that"; Phase 0c.2).
--
-- Drops the branches table and every branch_id column. Orders matter:
--   1. drop every foreign key pointing at branches (inline REFERENCES in
--      001_baseline.sql generated auto names like jobs_branch_id_fkey, so the
--      constraints are discovered from the catalog instead of guessed),
--   2. drop the branch_id columns themselves,
--   3. drop the branches table.
-- jobs/expenses/equipment/inventory keep their history; the column simply
-- disappears with the concept. employees.branch_id (added in 003) goes too.

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT rel.relname AS table_name, c.conname AS constraint_name
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    WHERE c.contype = 'f'
      AND c.confrelid = 'branches'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.table_name, fk.constraint_name);
  END LOOP;
END $$;

ALTER TABLE jobs            DROP COLUMN IF EXISTS branch_id;
ALTER TABLE expenses        DROP COLUMN IF EXISTS branch_id;
ALTER TABLE equipment       DROP COLUMN IF EXISTS branch_id;
ALTER TABLE inventory_items DROP COLUMN IF EXISTS branch_id;
ALTER TABLE employees       DROP COLUMN IF EXISTS branch_id;

DROP TABLE IF EXISTS branches;
