-- 004_numbering.sql
-- Server-side document numbering (plan sections 8.5, 8.6; Phase 0.8).
--
-- A document_sequences table holds one row per document prefix (JOB, INV,
-- LDY, plus PAY + JNL reserved for later phases). nextNumber() is implemented
-- in server/services/numbering.ts as UPDATE ... RETURNING inside the same
-- transaction as the row insert, so concurrent creates can never collide —
-- unlike the retired client-side JOB-${jobs.length + 143} scheme, which
-- repeated after any deletion or concurrent create.
--
-- The seed rows start above the highest number already present in the demo
-- data (JOB-00144, INV-00098, LDY-00216), so legacy and server-issued
-- numbers never overlap. Additive only and safe to re-run.

CREATE TABLE IF NOT EXISTS document_sequences (
  key TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  width INT NOT NULL DEFAULT 5,
  next_value INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep updated_at honest on sequence bumps.
DROP TRIGGER IF EXISTS document_sequences_touch ON document_sequences;
CREATE TRIGGER document_sequences_touch BEFORE UPDATE ON document_sequences
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Widths match the existing document shapes: JOB-00144, INV-00098, LDY-00216.
INSERT INTO document_sequences (key, prefix, width, next_value) VALUES
  ('job', 'JOB', 5, 145),
  ('invoice', 'INV', 5, 99),
  ('laundry', 'LDY', 5, 217)
ON CONFLICT (key) DO NOTHING;

-- Lift any sequence past numbers imported later (a backup containing
-- JOB-00200 must not cause the next create to reuse JOB-00145).
-- next_value becomes GREATEST(next_value, max(found) + 1) per prefix.
DO $$
BEGIN
  UPDATE document_sequences s SET next_value = GREATEST(s.next_value, sub.max_n + 1)
  FROM (
    SELECT 145 AS base, COALESCE(MAX(NULLIF(regexp_replace(number, '^JOB-0*', ''), '')::int), 144) AS max_n, 'job' AS key
    FROM jobs
  ) sub WHERE s.key = sub.key;

  UPDATE document_sequences s SET next_value = GREATEST(s.next_value, sub.max_n + 1)
  FROM (
    SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '^INV-0*', ''), '')::int), 98) AS max_n, 'invoice' AS key
    FROM invoices
  ) sub WHERE s.key = sub.key;

  UPDATE document_sequences s SET next_value = GREATEST(s.next_value, sub.max_n + 1)
  FROM (
    SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '^LDY-0*', ''), '')::int), 216) AS max_n, 'laundry' AS key
    FROM laundry_orders
  ) sub WHERE s.key = sub.key;
END $$;
