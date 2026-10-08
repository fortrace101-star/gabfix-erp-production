-- 013_delivery_notes.sql (Phase 2b extension)
--
-- Adds the columns the delivery-note document (plan §12) needs: a signature
-- image reference captured on proof-of-delivery, and the name of the person
-- who received the order. Both are optional and default to NULL so existing
-- rows are unaffected; they are populated by the laundromat's handheld scanner
-- or tablet when the order is handed over.
--
-- Additive only; safe to re-run. Branchless by decision #9 (no branch_id).

ALTER TABLE laundry_orders
  ADD COLUMN IF NOT EXISTS signature TEXT,
  ADD COLUMN IF NOT EXISTS received_by TEXT;

-- Add a sequence for delivery note numbers, separate from the laundry LDY
-- series (delivery notes are fulfilment confirmations, not laundry orders).
INSERT INTO document_sequences (key, prefix, width, next_value) VALUES
  ('delivery_note', 'DLV', 5, 1)
ON CONFLICT (key) DO NOTHING;
