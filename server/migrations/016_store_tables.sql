-- 016_store_tables.sql (Phase E groundwork — store operational data)
--
-- The Gabfix Store prototype currently renders demo arrays from
-- gabfix-store/src/lib/store-data.ts. This migration moves that dataset into
-- the database so every app reads it through the server API (multi-app-plan v5
-- decision D1: the server is the single source of truth; clients hold no data).
--
-- One concern: the store's extension tables. `suppliers` (010) already exists —
-- we extend it with the contact/rating/spend columns the Store UI shows.
-- inventory_items gains the store-facing columns (code, supplier, location,
-- reorder_level). The remaining store concerns get their own tables:
--   inventory_movements  — receive/issue/adjust/return audit trail
--   purchase_requests    — raise in Store → approve in Admin
--   tool_checkouts       — tools & equipment check-out/in to employee + job
--   utility_captures     — meter readings + slips (power/water/fuel/…)
--
-- Idempotent: everything is IF NOT EXISTS / ON CONFLICT DO NOTHING, and the
-- seed mirrors gabfix-store/src/lib/store-data.ts exactly (the store app keeps
-- rendering the same numbers once wired to /api/data). Additive only.

-- ── Suppliers: extend with the store-facing columns ────────────────────────
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS contact TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS categories TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS spend_ytd NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating TEXT NOT NULL DEFAULT 'Approved'
    CHECK (rating IN ('Preferred', 'Approved', 'Watchlist'));

-- The two suppliers seeded by 010 keep their identity; store suppliers from
-- the prototype dataset join them (contact = the person, phone = the line).
INSERT INTO suppliers (id, name, phone, notes, contact, categories, spend_ytd, rating) VALUES
  ('sup3', 'Kampala Hardware Ltd',  '+256 772 114 220', 'Masonry and ceilings materials', 'Sam Lubega',     'Masonry, Ceilings',       42800000, 'Preferred'),
  ('sup4', 'Hima Depot Ntinda',     '+256 700 111 222', 'Cement and aggregates',          'Peter Wasswa',   'Masonry',                  8160000, 'Approved'),
  ('sup5', 'Volt Supplies UG',      '+256 700 884 512', 'Electrical materials',           'Ritah Nabwire',  'Electrical',              28400000, 'Preferred'),
  ('sup6', 'Sadolin Kololo',        '+256 700 333 444', 'Paints and finishes',            'Agnes Kirabo',   'Finishes',                 4495000, 'Approved'),
  ('sup7', 'Tilemart Nakawa',       '+256 782 330 907', 'Tiles, adhesives, consumables',  'Eric Mugisha',   'Finishes, Consumables',   11250000, 'Approved'),
  ('sup8', 'Aqua Fittings Ltd',     '+256 704 662 018', 'Plumbing fittings and fixtures', 'Joan Kirabo',    'Plumbing',                 9600000, 'Approved'),
  ('sup9', 'Lweza Aggregates',      '+256 758 221 743', 'Sand and aggregates',            'Musa Sentongo',  'Masonry',                  6400000, 'Watchlist'),
  ('sup10', 'Roofings Group',       '+256 700 555 666', 'Steel bars and sections',        'David Ssemakula', 'Masonry',                 3648000, 'Approved')
ON CONFLICT (id) DO NOTHING;

-- sup1 'Kampala Hardware Ltd' already exists from 010 with a different phone —
-- prefer the store dataset's contact line for the store UI (idempotent re-run safe).
UPDATE suppliers SET phone = '+256 772 114 220', contact = 'Sam Lubega',
                    categories = 'Masonry, Ceilings', spend_ytd = 42800000, rating = 'Preferred'
WHERE id = 'sup1';

-- ── Inventory items: store-facing columns (code, supplier, location) ───────
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS supplier_id TEXT REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'facility'
    CHECK (kind IN ('facility', 'contract'));

-- Contract materials from the store prototype dataset. `minimum` IS the
-- reorder level (existing semantic). `cost` is unit cost. Store items are
-- kind='contract'; the laundry/facility items seeded earlier stay 'facility'.
INSERT INTO inventory_items (id, name, category, unit, quantity, minimum, cost, code, supplier_id, location, kind) VALUES
  ('sinvm1',  'PVC pipe 1/2" x 3m',        'Plumbing',     'length', 148, 60, 12500,  'MAT-001', 'sup3',  'Rack A1',    'contract'),
  ('sinvm2',  'Cement 50kg (Hima)',        'Masonry',      'bag',    24,  40, 34000,  'MAT-002', 'sup4',  'Floor bay 2','contract'),
  ('sinvm3',  'Twin cable 2.5mm',          'Electrical',   'roll',   9,   20, 185000, 'MAT-003', 'sup5',  'Cage E',     'contract'),
  ('sinvm4',  'Emulsion paint white 20L',  'Finishes',     'bucket', 31,  15, 145000, 'MAT-004', 'sup6',  'Rack C3',    'contract'),
  ('sinvm5',  'Gypsum board 8x4',          'Ceilings',     'sheet',  0,   25, 52000,  'MAT-005', 'sup3',  'Rack B2',    'contract'),
  ('sinvm6',  'Tile adhesive 20kg',        'Finishes',     'bag',    63,  30, 41000,  'MAT-006', 'sup7',  'Floor bay 1','contract'),
  ('sinvm7',  'Conduit pipe 20mm',         'Electrical',   'length', 210, 80, 8500,   'MAT-007', 'sup5',  'Rack A4',    'contract'),
  ('sinvm8',  'Mixer tap chrome',          'Plumbing',     'piece',  14,  12, 96000,  'MAT-008', 'sup8',  'Cage P',     'contract'),
  ('sinvm9',  'Silicone sealant',          'Consumables',  'tube',   5,   24, 18000,  'MAT-009', 'sup7',  'Shelf S1',   'contract'),
  ('sinvm10', 'Sand (tipper share)',       'Masonry',      'm³',     18,  10, 62000,  'MAT-010', 'sup9',  'Yard',       'contract'),
  ('sinvm11', 'Steel bar Y12',             'Masonry',      'bar',    76,  50, 48000,  'MAT-011', 'sup10', 'Yard rack',  'contract'),
  ('sinvm12', 'Door lockset',              'Carpentry',    'set',    22,  10, 78000,  'MAT-012', 'sup8',  'Cage P',     'contract')
ON CONFLICT (id) DO NOTHING;

-- Backfill codes for the facility items (laundry/cleaning supplies from the
-- original seed) so every inventory row displays a stable code.
UPDATE inventory_items SET code = 'FAC-' || LPAD((
  SELECT COUNT(*)::text FROM inventory_items AS prior
  WHERE prior.id <= inventory_items.id
)::text, 3, '0')
WHERE code IS NULL;

-- ── Inventory movements (the store's movement ledger) ─────────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES inventory_items(id),
  type TEXT NOT NULL CHECK (type IN ('Received', 'Issued', 'Adjustment', 'Return')),
  qty NUMERIC NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  moved_on DATE NOT NULL,
  by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements(item_id);

DROP TRIGGER IF EXISTS inventory_movements_touch ON inventory_movements;
CREATE TRIGGER inventory_movements_touch BEFORE UPDATE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO inventory_movements (id, item_id, type, qty, reference, moved_on, by_name) VALUES
  ('mv1', 'sinvm1',  'Issued',     -24, 'JOB-00184 · Ntinda villa',  '2026-09-28', 'Moses Okello'),
  ('mv2', 'sinvm6',  'Received',    40, 'GRN-00421',                 '2026-09-28', 'Grace Atim'),
  ('mv3', 'sinvm3',  'Issued',      -6, 'JOB-00179 · Kololo rewire', '2026-09-27', 'Diana Achieng'),
  ('mv4', 'sinvm5',  'Issued',     -18, 'JOB-00180 · Bugolobi ceiling', '2026-09-27', 'John Kato'),
  ('mv5', 'sinvm9',  'Adjustment',  -3, 'Stock count variance',      '2026-09-26', 'Grace Atim'),
  ('mv6', 'sinvm11', 'Received',   100, 'GRN-00419',                 '2026-09-26', 'Grace Atim'),
  ('mv7', 'sinvm4',  'Return',       4, 'JOB-00172 · Muyenga',       '2026-09-25', 'Moses Okello'),
  ('mv8', 'sinvm2',  'Issued',     -30, 'JOB-00184 · Ntinda villa',  '2026-09-25', 'John Kato')
ON CONFLICT (id) DO NOTHING;

-- ── Purchase requests (raise in Store → approve in Admin) ──────────────────
CREATE TABLE IF NOT EXISTS purchase_requests (
  id TEXT PRIMARY KEY,
  item_id TEXT REFERENCES inventory_items(id),
  description TEXT NOT NULL DEFAULT '',
  qty NUMERIC NOT NULL DEFAULT 0,
  supplier_id TEXT REFERENCES suppliers(id),
  value NUMERIC NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL DEFAULT '',
  requested_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Pending approval', 'Approved', 'Rejected')),
  decided_by TEXT NOT NULL DEFAULT '',
  decided_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS purchase_requests_touch ON purchase_requests;
CREATE TRIGGER purchase_requests_touch BEFORE UPDATE ON purchase_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO purchase_requests (id, item_id, description, qty, supplier_id, value, requested_by, requested_on, status) VALUES
  ('pr1', 'sinvm5',  'Gypsum board 8x4',   60, 'sup3', 3120000, 'Grace Atim',   '2026-09-28', 'Pending approval'),
  ('pr2', 'sinvm3',  'Twin cable 2.5mm',   20, 'sup5', 3700000, 'Grace Atim',   '2026-09-27', 'Pending approval'),
  ('pr3', 'sinvm2',  'Cement 50kg (Hima)', 80, 'sup4', 2720000, 'John Kato',    '2026-09-26', 'Approved'),
  ('pr4', 'sinvm9',  'Silicone sealant',   48, 'sup7', 864000,  'Grace Atim',   '2026-09-24', 'Draft'),
  ('pr5', 'sinvm8',  'Mixer tap chrome',   10, 'sup8', 960000,  'Diana Achieng', '2026-09-22', 'Rejected')
ON CONFLICT (id) DO NOTHING;

-- ── Tool checkouts (tools & equipment — store lens over equipment) ─────────
-- `equipment` (011) is the asset register with depreciation. Tools are the
-- small wares the store lends out; they get their own lightweight table so the
-- store UI keeps its shape, with a nullable equipment link for expensive ones.
CREATE TABLE IF NOT EXISTS tool_checkouts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT 'Good' CHECK (condition IN ('Good', 'Fair', 'Needs repair')),
  status TEXT NOT NULL DEFAULT 'In store' CHECK (status IN ('In store', 'Checked out', 'Overdue', 'In repair')),
  holder_employee_id UUID REFERENCES employees(id),
  holder_name TEXT NOT NULL DEFAULT '',
  job_id TEXT REFERENCES jobs(id),
  job_label TEXT NOT NULL DEFAULT '',
  due_back DATE,
  notes TEXT NOT NULL DEFAULT '',
  equipment_id TEXT REFERENCES equipment(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tool_checkouts_touch ON tool_checkouts;
CREATE TRIGGER tool_checkouts_touch BEFORE UPDATE ON tool_checkouts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO tool_checkouts (id, code, name, condition, status, holder_name, job_label, due_back, notes) VALUES
  ('t1', 'TL-014', 'Bosch rotary hammer',     'Good',         'Checked out', 'Moses Okello',  'JOB-00184 · Ntinda villa', '2026-09-29', 'New chisel set attached'),
  ('t2', 'TL-021', 'Pipe threading machine',  'Fair',         'Overdue',     'John Kato',     'JOB-00180 · Bugolobi',     '2026-09-25', 'Oil top-up needed'),
  ('t3', 'TL-002', 'Ladder 4m aluminium',     'Good',         'In store',    '',              '',                         NULL,         ''),
  ('t4', 'TL-008', 'Angle grinder 5"',        'Needs repair', 'In repair',   '',              '',                         NULL,         'Switch faulty — at Nakawa workshop'),
  ('t5', 'TL-031', 'Multimeter Fluke 117',    'Good',         'Checked out', 'Diana Achieng', 'JOB-00179 · Kololo rewire', '2026-09-30', ''),
  ('t6', 'TL-005', 'Concrete mixer 350L',     'Fair',         'In store',    '',              '',                         NULL,         'Serviced 12 Sep'),
  ('t7', 'TL-019', 'Tile cutter 900mm',       'Good',         'Checked out', 'Peter Ssali',   'JOB-00186 · Muyenga bath', '2026-10-02', '')
ON CONFLICT (id) DO NOTHING;

-- ── Utility captures (meter readings + slips → expenses) ───────────────────
CREATE TABLE IF NOT EXISTS utility_captures (
  id TEXT PRIMARY KEY,
  captured_on DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Power', 'Water', 'Fuel', 'Transport', 'Maintenance')),
  reference TEXT NOT NULL DEFAULT '',
  reading TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  category_kind TEXT NOT NULL DEFAULT 'operations' CHECK (category_kind IN ('direct', 'operations')),
  captured_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Quarantined' CHECK (status IN ('Quarantined', 'Approved', 'Rejected')),
  expense_id TEXT REFERENCES expenses(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS utility_captures_touch ON utility_captures;
CREATE TRIGGER utility_captures_touch BEFORE UPDATE ON utility_captures
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

INSERT INTO utility_captures (id, captured_on, type, reference, reading, amount, category_kind, captured_by, status) VALUES
  ('u1', '2026-09-28', 'Fuel',        'Shell Ntinda · 441882',       '42.5 L',             236000, 'direct',     'Moses Okello', 'Quarantined'),
  ('u2', '2026-09-27', 'Power',       'Yaka meter 0431 7719',        '1,284 → 1,412 kWh',  410000, 'operations', 'Grace Atim',   'Quarantined'),
  ('u3', '2026-09-26', 'Water',       'NWSC acct 88213',             '214 → 231 m³',       128000, 'operations', 'Grace Atim',   'Approved'),
  ('u4', '2026-09-25', 'Transport',   'Truck hire UBK 442H',         'Kololo run',         180000, 'direct',     'John Kato',    'Approved'),
  ('u5', '2026-09-24', 'Maintenance', 'Grinder repair TL-008',       'Workshop slip 118',  95000,  'operations', 'Grace Atim',   'Quarantined'),
  ('u6', '2026-09-22', 'Fuel',        'Total Kamwokya · 30219',      '31 L',               172000, 'direct',     'Diana Achieng', 'Rejected')
ON CONFLICT (id) DO NOTHING;

-- ── Reset/import plumbing: these tables participate in the workspace cycle ─
-- (lib/tables.ts TRUNCATE_TABLES and db.ts reads are updated in the same slice.)
