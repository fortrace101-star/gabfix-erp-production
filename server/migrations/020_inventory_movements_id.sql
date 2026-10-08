-- 020_inventory_movements_id.sql
-- Phase E: give inventory_movements.id a default so fresh inserts don't
-- require an explicit id (the store route now generates one via
-- placeholderId(), but this backup-safety net makes the column self-
-- sufficient for any future direct inserts).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_movements_id_default'
      AND conrelid = 'inventory_movements'::regclass
  ) THEN
    -- Add a default using gen_random_uuid() so the column is self-sufficient.
    ALTER TABLE inventory_movements
      ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;

-- Backfill any rows that lack an id (shouldn't exist after the route fix,
-- but harmless if they do).
UPDATE inventory_movements
SET id = gen_random_uuid()::text
WHERE id IS NULL OR id = '';
