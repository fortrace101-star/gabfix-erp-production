import type { ClientBase } from 'pg';
import bcrypt from 'bcryptjs';

/**
 * Ensures an owner employee exists, mapping to the hardcoded sidebar chip
 * (Gabriel N. / Owner account). Runs on every bootstrap so databases seeded
 * before identity landed still get their owner (Phase 0.4).
 *
 * The initial password comes from OWNER_PASSWORD (see .env.example) and is
 * hashed here rather than in SQL. Change it after first login.
 */
export async function ensureOwner(client: ClientBase): Promise<void> {
  const existing = await client.query(
    `SELECT 1 FROM employees WHERE role = 'owner' AND deleted_at IS NULL LIMIT 1`,
  );
  if (existing.rows.length) {
    // The owner is the control-plane apex: keep its app_scope covering all four
    // apps even when the row was created before migration 005 (or its scope was
    // reset alongside it). Mirrors the 005 backfill on every bootstrap/reset.
    await client.query(
      `UPDATE employees SET app_scope = ARRAY['admin','laundry','portal','store']::TEXT[]
       WHERE role = 'owner' AND deleted_at IS NULL`,
    );
    return;
  }

  const password = process.env.OWNER_PASSWORD || 'gabfix-owner';
  const pinHash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO employees (id, name, role, phone, email, pin_hash, active)
     VALUES ('00000000-0000-4000-8000-000000000001', 'Gabriel N.', 'owner', '', '', $1, TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [pinHash],
  );
  console.log('[db] Owner employee ensured (password from OWNER_PASSWORD)');
}

/**
 * Demo staff so every app has a working login (plan v5: laundry/portal/store
 * need real employees to authenticate). Fixed UUIDs + ON CONFLICT keep it
 * idempotent; employees are not in TRUNCATE_TABLES so staff survives resets.
 * Password comes from STAFF_PASSWORD (default 'gabfix-staff') and is hashed once.
 */
export async function ensureStaff(client: ClientBase): Promise<void> {
  const password = process.env.STAFF_PASSWORD || 'gabfix-staff';
  const pinHash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO employees (id, name, role, phone, email, app_scope, pin_hash, active)
     VALUES
       ('00000000-0000-4000-8000-000000000010', 'Grace Atim',    'manager',     '+256 772 100 010', 'grace@gabfix.ug', ARRAY['admin','store']::TEXT[],             $1, TRUE),
       ('00000000-0000-4000-8000-000000000011', 'Moses Okello',  'storekeeper', '+256 772 100 011', 'moses@gabfix.ug', ARRAY['store']::TEXT[],                     $1, TRUE),
       ('00000000-0000-4000-8000-000000000012', 'Diana Achieng', 'laundry',     '+256 772 100 012', 'diana@gabfix.ug', ARRAY['laundry']::TEXT[],                   $1, TRUE),
       ('00000000-0000-4000-8000-000000000013', 'John Kato',     'technician',  '+256 772 100 013', 'john@gabfix.ug',  ARRAY['portal']::TEXT[],                    $1, TRUE),
       ('00000000-0000-4000-8000-000000000014', 'Peter Ssali',   'sales',       '+256 772 100 014', 'peter@gabfix.ug', ARRAY['portal']::TEXT[],                    $1, TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [pinHash],
  );
  // Repair stale empty app_scope for the seeded staff only (idempotent; never
  // clobbers an admin-set non-empty scope). Mirrors migration 005's role->scope
  // backfill so a server restart always self-heals DBs seeded before multi-app
  // identity landed (the INSERT above uses ON CONFLICT DO NOTHING, so it cannot).
  await client.query(
    `UPDATE employees
        SET app_scope = CASE role
          WHEN 'owner'      THEN ARRAY['admin','laundry','portal','store']::TEXT[]
          WHEN 'manager'    THEN ARRAY['admin','store']::TEXT[]
          WHEN 'accountant' THEN ARRAY['admin','store']::TEXT[]
          WHEN 'sales'      THEN ARRAY['portal']::TEXT[]
          WHEN 'technician' THEN ARRAY['portal']::TEXT[]
          WHEN 'laundry'    THEN ARRAY['laundry']::TEXT[]
          WHEN 'storekeeper' THEN ARRAY['store']::TEXT[]
          ELSE ARRAY[]::TEXT[]
        END
      WHERE id IN (
        '00000000-0000-4000-8000-000000000010',
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000012',
        '00000000-0000-4000-8000-000000000013',
        '00000000-0000-4000-8000-000000000014'
      ) AND (app_scope IS NULL OR app_scope = '{}')`,
  );
  console.log('[db] Demo staff ensured (password from STAFF_PASSWORD)');
}

/**
 * Seeds the initial Gabfix demo data — the same records the app previously shipped
 * with in the frontend (seedData in App.tsx).
 */
export async function seedData(client: ClientBase) {
  await client.query(
    `INSERT INTO customers (id, name, company, type, phone, email, balance, status) VALUES
      ('c1', 'Sarah Namuli', '', 'Residential', '+256 772 441 208', 'sarah@example.com', 0, 'Active'),
      ('c2', 'ABC Offices Ltd', 'ABC Offices Ltd', 'Corporate Client', '+256 701 820 445', 'admin@abcoffices.ug', 1250000, 'Active'),
      ('c3', 'Mirembe Properties', 'Mirembe Properties', 'Property Manager', '+256 759 114 801', 'hello@mirembe.ug', 760000, 'Active'),
      ('c4', 'David Kato', '', 'Residential', '+256 788 210 117', 'david@example.com', 0, 'Active'),
      ('c5', 'Greenfield Academy', 'Greenfield Academy', 'Institution', '+256 704 556 233', 'finance@greenfield.ug', 2180000, 'Active'),
      ('c6', 'Nakasero Apartments', 'Nakasero Apartments', 'Corporate Client', '+256 778 100 440', 'manager@nakasero.ug', 0, 'Active'),
      ('c7', 'James Okello', '', 'Walk-in Customer', '+256 753 993 200', 'james@example.com', 85000, 'Active'),
      ('c8', 'Lakeside Restaurant', 'Lakeside Restaurant', 'Business', '+256 700 002 341', 'accounts@lakeside.ug', 430000, 'Active')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO services (id, name, division, method, price, active) VALUES
      ('s1', 'House Cleaning', 'Cleaning Services', 'Fixed price', 180000, TRUE),
      ('s2', 'Deep Cleaning', 'Cleaning Services', 'Fixed price', 420000, TRUE),
      ('s3', 'Office Cleaning Contract', 'Contract Cleaning', 'Per visit', 650000, TRUE),
      ('s4', 'Car Detailing', 'Vehicle Services', 'Per vehicle', 220000, TRUE),
      ('s5', 'Electrical Repair', 'Home Solutions', 'Per hour', 120000, TRUE),
      ('s6', 'Plumbing', 'Home Solutions', 'Custom quotation', 250000, TRUE),
      ('s7', 'AC Cleaning', 'Home Solutions', 'Per machine', 150000, TRUE),
      ('s8', 'Laundry per KG', 'Laundry', 'Per kilogram', 5000, TRUE),
      ('s9', 'Laundry per Item', 'Laundry', 'Per item', 3000, TRUE),
      ('s10', 'Ironing', 'Laundry', 'Per item', 1000, TRUE),
      ('s11', 'Carpet Cleaning', 'Cleaning Services', 'Per square meter', 12000, TRUE),
      ('s12', 'Post Construction Cleaning', 'Cleaning Services', 'Custom quotation', 800000, TRUE)
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO jobs (id, number, customer_id, service_id, date, status, revenue, cost, assignees, equipment_usage) VALUES
      ('j1', 'JOB-00142', 'c2', 's3', '2026-09-03', 'In Progress', 650000, 280000, '{"Moses K.","Agnes N."}', '[]'),
      ('j2', 'JOB-00141', 'c1', 's2', '2026-09-03', 'Completed', 420000, 135000, '{"Sarah A."}', '[]'),
      ('j3', 'JOB-00140', 'c5', 's7', '2026-09-02', 'Scheduled', 450000, 95000, '{"John O."}', '[]'),
      ('j4', 'JOB-00139', 'c4', 's4', '2026-09-02', 'Completed', 220000, 70000, '{"Peter L."}', '[]'),
      ('j5', 'JOB-00138', 'c3', 's5', '2026-09-01', 'Completed', 540000, 260000, '{"David T."}', '[]'),
      ('j6', 'JOB-00137', 'c8', 's6', '2026-08-31', 'Quoted', 780000, 320000, '{}', '[]')
     ON CONFLICT (id) DO NOTHING`
    );

  // Dual-write job_assignments from the legacy assignees names (migration 009
  // strategy: the join table owns crew scoping now the portal reads it; the
  // text[] column stays for the admin forms during the transition). Idempotent.
  await client.query(
    `INSERT INTO job_assignments (job_id, employee_id, role)
      VALUES
        ('j1', '00000000-0000-4000-8000-000000000013', 'technician'),
        ('j3', '00000000-0000-4000-8000-000000000013', 'technician'),
        ('j5', '00000000-0000-4000-8000-000000000013', 'technician')
      ON CONFLICT (job_id, employee_id) DO NOTHING`
  );

  // Replicate the 009 backfill so /api/reset matches a migrated database:
  // the migration only ran once on the pre-existing data, but the seed runs
  // on every reset. Same idempotent WHERE-IS-NULL rule as 009.
  await client.query(`UPDATE jobs SET scheduled_date = date WHERE scheduled_date IS NULL`);
  await client.query(`UPDATE jobs SET quote_date = date WHERE status = 'Quoted' AND quote_date IS NULL`);
  await client.query(`UPDATE jobs SET started_at = date::timestamptz + interval '9 hours'
    WHERE status IN ('Completed', 'In Progress') AND started_at IS NULL`);
  await client.query(`UPDATE jobs SET completed_at = date::timestamptz + interval '17 hours'
    WHERE status = 'Completed' AND completed_at IS NULL`);

  await client.query(
    `INSERT INTO invoices (id, number, customer_id, date, due, total, paid, status) VALUES
      ('i1', 'INV-00098', 'c2', '2026-08-30', '2026-09-06', 3250000, 2000000, 'Partially Paid'),
      ('i2', 'INV-00097', 'c5', '2026-08-18', '2026-09-01', 2180000, 0, 'Overdue'),
      ('i3', 'INV-00096', 'c3', '2026-08-28', '2026-09-11', 1760000, 1000000, 'Partially Paid'),
      ('i4', 'INV-00095', 'c1', '2026-08-26', '2026-08-30', 420000, 420000, 'Paid'),
      ('i5', 'INV-00094', 'c4', '2026-08-25', '2026-08-25', 220000, 220000, 'Paid')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO expenses (id, category, description, amount, date, division) VALUES
      ('e1', 'Payroll', 'August field team payroll', 4800000, '2026-08-30', 'Company overhead'),
      ('e2', 'Supplies', 'Cleaning chemicals & PPE', 1120000, '2026-09-01', 'Cleaning Services'),
      ('e3', 'Fuel', 'Field vehicles fuel', 680000, '2026-09-02', 'Company overhead'),
      ('e4', 'Repairs', 'Washer drain pump replacement', 350000, '2026-08-29', 'Laundry'),
      ('e5', 'Rent', 'September workspace rent', 1800000, '2026-09-01', 'Company overhead'),
      ('e6', 'Utilities', 'Water and electricity', 940000, '2026-08-28', 'Laundry')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO laundry_orders (id, number, customer_id, status, total, paid, items, received, ready_at, collected_at) VALUES
      ('l1', 'LDY-00216', 'c7', 'Ready', 85000, 50000, '10kg wash + iron', '2026-09-03', '2026-09-03', NULL),
      ('l2', 'LDY-00215', 'c1', 'Washing', 125000, 125000, 'Blankets, shirts, duvet', '2026-09-02', NULL, NULL),
      ('l3', 'LDY-00214', 'c4', 'Collected', 64000, 64000, '16kg wash', '2026-09-01', '2026-09-01', '2026-09-01'),
      ('l4', 'LDY-00213', 'c6', 'Drying', 210000, 0, 'Hotel linen bundle', '2026-09-03', NULL, NULL)
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO equipment (id, name, serial_number, type, value, book_value, condition, next_maintenance, usage,
                            purchase_date, cost, salvage_value, useful_life_months, depreciation_method) VALUES
      ('a1', 'Industrial Washer WM-003', 'WM-2021-001', 'Washing machine', 10000000, 8500000, 'Good', '2026-09-10', 384,  '2026-01-01', 10000000, 1000000, 60, 'straight-line'),
      ('a2', 'Commercial Dryer DR-002',  'DR-2022-014', 'Dryer',           7600000,  6200000, 'Good', '2026-09-18', 292,  '2026-01-01',  7600000,  760000, 60, 'straight-line'),
      ('a3', 'Toyota Hiace UBD 442K',    'UBD-442K',    'Vehicle',        48000000, 35600000, 'Good', '2026-09-06', 12840, '2026-01-01', 48000000, 4800000, 96, 'straight-line'),
      ('a4', 'Karcher Pressure Washer',  'KPW-339-X',   'Pressure washer',  4200000,  3400000, 'Maintenance due', '2026-09-03', 118, '2026-01-01',  4200000,  420000, 48, 'straight-line'),
      ('a5', 'Industrial Ironing Press', 'IIP-880',     'Ironing machine',  5300000,  4900000, 'Good', '2026-10-01', 164,  '2026-01-01',  5300000,  530000, 60, 'straight-line')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO inventory_items (id, name, category, unit, quantity, minimum, cost) VALUES
      ('inv1', 'Laundry detergent', 'Laundry supplies', 'kg', 18, 25, 14500),
      ('inv2', 'Fabric softener', 'Laundry supplies', 'litre', 42, 20, 12000),
      ('inv3', 'Disinfectant', 'Cleaning supplies', 'litre', 64, 30, 8500),
      ('inv4', 'Microfiber cloths', 'Cleaning supplies', 'pack', 11, 15, 22000),
      ('inv5', 'Car shampoo', 'Detailing materials', 'litre', 36, 12, 18000),
      ('inv6', 'Plumbing fittings', 'Repair materials', 'box', 8, 5, 95000)
     ON CONFLICT (id) DO NOTHING`
  );

  // Store (contract-division) dataset — mirrors migration 016. Reset truncates
  // inventory_items (cascading to the store tables), so the seed restores the
  // same rows a migrated database carries (same idempotent rule as the 009
  // backfill replication above). Suppliers are master data and survive resets;
  // on fresh databases migration 016 seeds them.
  await seedStoreData(client);

  // CRM slices (migration 021 tables) so a signed-in sales/CSR employee has
  // leads and follow-ups to see. Migration-time seeds do not survive a reset.
  await seedCrmData(client);

  // Platform provisioning from 014 — settings + message_templates are seeded by
  // the migration only when it first runs, but /api/reset truncates both tables.
  // Restore them here so a reset workspace stays fully provisioned.
  await seedPlatformData(client);
}

/**
 * Platform rows from migration 014: the single settings row and the six
 * message templates (email/sms/inapp for job_completion + job_appreciation).
 * Idempotent — on fresh databases 014 already inserted them.
 */
async function seedPlatformData(client: ClientBase) {
  await client.query(
    `INSERT INTO settings (id, company_name, company_tagline, company_phone)
     VALUES (1, 'Gabfix', 'Cleaning, laundry and facility services', '+256 700 000 000')
     ON CONFLICT (id) DO NOTHING`,
  );

  await client.query(
    `INSERT INTO message_templates (key, channel, subject, body, variables, approved) VALUES
      ('job_completion', 'email', 'Your service is complete',
       '{{customer_name}}, your {{service_name}} on {{date}} has been completed by {{technician}}. Subtotal: {{total}}. Paid: {{paid}}. Balance: {{balance}}. Invoice: {{invoice_pdf_url}} Feedback: {{feedback_url}}',
       ARRAY['customer_name','service_name','date','technician','total','paid','balance','invoice_pdf_url','feedback_url'], FALSE),
      ('job_completion', 'sms', NULL,
       '{{customer_name}}, {{service_name}} completed {{date}} by {{technician}}. Total {{total}}, paid {{paid}}, balance {{balance}}. Feedback: {{feedback_url}}',
       ARRAY['customer_name','service_name','date','total','paid','balance','feedback_url'], FALSE),
      ('job_appreciation', 'email', 'Thank you for choosing Gabfix',
       '{{customer_name}}, we hope {{service_name}} on {{date}} met expectations. Your feedback helps us improve: {{feedback_url}}',
       ARRAY['customer_name','service_name','date','feedback_url'], FALSE),
      ('job_appreciation', 'sms', NULL,
       'Thank you, {{customer_name}}! How was {{service_name}} on {{date}}? Rate us: {{feedback_url}}',
       ARRAY['customer_name','service_name','date','feedback_url'], FALSE),
      ('job_completion', 'inapp', NULL,
       '{{customer_name}}, your {{service_name}} on {{date}} has been completed. Balance: {{balance}}. Feedback: {{feedback_url}}',
       ARRAY['customer_name','service_name','date','balance','feedback_url'], TRUE),
      ('job_appreciation', 'inapp', NULL,
       'Thank you, {{customer_name}}! How was {{service_name}} on {{date}}? Rate us: {{feedback_url}}',
       ARRAY['customer_name','service_name','date','feedback_url'], TRUE),
      -- job.assigned: one in-app row per assignee (portal task list) plus the
      -- push row for the store bell; without these the scheduler flips the
      -- queued rows to 'failed' ("Template not found") and no bell shows them.
      ('job_assigned', 'inapp', NULL,
       'New job {{job_number}} — {{customer_name}} · {{service_name}} · {{scheduled}} {{address}}',
       ARRAY['job_number','customer_name','service_name','scheduled','address'], TRUE),
      ('job_assigned', 'push', NULL,
       'New job {{job_number}} — {{customer_name}}',
       ARRAY['job_number','customer_name','service_name','scheduled','address'], TRUE)
     ON CONFLICT (key, channel) DO NOTHING`,
  );
}

/**
 * CRM dataset (leads + follow-ups). The portal's Sales and CSR panes are scoped
 * to these rows: a lead is "theirs" when `salesperson_id` is them or is empty, a
 * follow-up via `owner_employee_id` or an unclaimed `owner_role`. Without them
 * those panes can only ever render their empty state.
 *
 * Peter Ssali is the fixture sales rep (`00000000-…-014`); the CSR row mirrors
 * migration 021's feedback_outreach intent against completed job `j5`.
 * Idempotent — safe to re-run.
 */
export async function seedCrmData(client: ClientBase) {
  const PETER = '00000000-0000-4000-8000-000000000014';

  await client.query(
    `INSERT INTO leads (id, name, contact, company, phone, email, salesperson_id, stage, value, source, next_follow_up_at, notes)
     VALUES
       ('lead-gf-1', 'Namutebi & Co.', 'Alice Namutebi', 'Namutebi & Co.', '+256 700 111 001', 'alice@namutebi.co', $1, 'Negotiation', 4800000, 'referral', now() + INTERVAL '1 day', 'Office cleaning contract — awaiting signed quote.'),
       ('lead-gf-2', 'Brian Mugisha', 'Brian Mugisha', '', '+256 700 222 002', 'brian@example.com', $1, 'Quoted', 1200000, 'website', now() + INTERVAL '2 days', 'Home plumbing installation — quote sent.'),
       ('lead-gf-3', 'Lakeview Apartments', 'Grace Lakeview', 'Lakeview Apartments', '+256 700 333 003', 'office@lakeview.co', $1, 'Contacted', 8600000, 'walk_in', now() + INTERVAL '3 days', 'Property maintenance contract — site visit booked.'),
       ('lead-gf-4', 'Florence Auma', 'Florence Auma', '', '+256 700 444 004', 'florence@example.com', NULL, 'Lead', 680000, 'social', now() + INTERVAL '4 days', 'Deep cleaning enquiry — unassigned, sales to pick up.'),
       ('lead-gf-5', 'Mirembe Properties', 'Patrick Mirembe', 'Mirembe Properties', '+256 700 555 005', 'admin@mirembe.co', $1, 'Won', 3200000, 'referral', NULL, 'Signed — converted to a recurring contract.')
     ON CONFLICT (id) DO NOTHING`,
    [PETER],
  );

  await client.query(
    `INSERT INTO follow_ups (id, type, owner_employee_id, owner_role, lead_id, job_id, notes, due_at, status, follow_up_after_days)
     VALUES
       ('11111111-1111-4111-8111-000000000001', 'client_follow_up', $1, 'sales', 'lead-gf-1', NULL, 'Call back on the Namutebi & Co. quotation.', now() + INTERVAL '1 day', 'pending', 3),
       ('11111111-1111-4111-8111-000000000002', 'client_follow_up', $1, 'sales', 'lead-gf-2', NULL, 'Check the Lakeview site-visit feedback.', now() + INTERVAL '2 days', 'pending', 3),
       ('11111111-1111-4111-8111-000000000003', 'client_follow_up', NULL, 'sales', 'lead-gf-4', NULL, 'Unassigned: first contact for the Florence Auma enquiry.', now() + INTERVAL '4 days', 'pending', 3),
       ('11111111-1111-4111-8111-000000000004', 'feedback_outreach', NULL, 'csr', NULL, 'j5', 'Feedback check-in for JOB-00138.', now() + INTERVAL '1 day', 'pending', 2)
     ON CONFLICT (id) DO NOTHING`,
    [PETER],
  );
}

/**
 * Store dataset (Phase E groundwork): contract materials, movements, purchase
 * requests, tool checkouts and utility captures — the rows gabfix-store's
 * prototype previously rendered from src/lib/store-data.ts. Idempotent.
 */
export async function seedStoreData(client: ClientBase) {
  await client.query(
    `INSERT INTO inventory_items (id, name, category, unit, quantity, minimum, cost, code, supplier_id, location, kind) VALUES
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
     ON CONFLICT (id) DO NOTHING`
  );

  // Facility items get codes too (016 does this for existing DBs; fresh DBs and
  // resets get it here).
  await client.query(
    `UPDATE inventory_items SET code = 'FAC-' || LPAD((
      SELECT COUNT(*)::text FROM inventory_items AS prior
      WHERE prior.id <= inventory_items.id
    )::text, 3, '0')
     WHERE code IS NULL`,
  );

  await client.query(
    `INSERT INTO inventory_movements (id, item_id, type, qty, reference, moved_on, by_name) VALUES
      ('mv1', 'sinvm1',  'Issued',     -24, 'JOB-00184 · Ntinda villa',  '2026-09-28', 'Moses Okello'),
      ('mv2', 'sinvm6',  'Received',    40, 'GRN-00421',                 '2026-09-28', 'Grace Atim'),
      ('mv3', 'sinvm3',  'Issued',      -6, 'JOB-00179 · Kololo rewire', '2026-09-27', 'Diana Achieng'),
      ('mv4', 'sinvm5',  'Issued',     -18, 'JOB-00180 · Bugolobi ceiling', '2026-09-27', 'John Kato'),
      ('mv5', 'sinvm9',  'Adjustment',  -3, 'Stock count variance',      '2026-09-26', 'Grace Atim'),
      ('mv6', 'sinvm11', 'Received',   100, 'GRN-00419',                 '2026-09-26', 'Grace Atim'),
      ('mv7', 'sinvm4',  'Return',       4, 'JOB-00172 · Muyenga',       '2026-09-25', 'Moses Okello'),
      ('mv8', 'sinvm2',  'Issued',     -30, 'JOB-00184 · Ntinda villa',  '2026-09-25', 'John Kato')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO purchase_requests (id, item_id, description, qty, supplier_id, value, requested_by, requested_on, status) VALUES
      ('pr1', 'sinvm5',  'Gypsum board 8x4',   60, 'sup3', 3120000, 'Grace Atim',   '2026-09-28', 'Pending approval'),
      ('pr2', 'sinvm3',  'Twin cable 2.5mm',   20, 'sup5', 3700000, 'Grace Atim',   '2026-09-27', 'Pending approval'),
      ('pr3', 'sinvm2',  'Cement 50kg (Hima)', 80, 'sup4', 2720000, 'John Kato',    '2026-09-26', 'Approved'),
      ('pr4', 'sinvm9',  'Silicone sealant',   48, 'sup7', 864000,  'Grace Atim',   '2026-09-24', 'Draft'),
      ('pr5', 'sinvm8',  'Mixer tap chrome',   10, 'sup8', 960000,  'Diana Achieng', '2026-09-22', 'Rejected')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO tool_checkouts (id, code, name, condition, status, holder_name, job_label, due_back, notes) VALUES
      ('t1', 'TL-014', 'Bosch rotary hammer',     'Good',         'Checked out', 'Moses Okello',  'JOB-00184 · Ntinda villa', '2026-09-29', 'New chisel set attached'),
      ('t2', 'TL-021', 'Pipe threading machine',  'Fair',         'Overdue',     'John Kato',     'JOB-00180 · Bugolobi',     '2026-09-25', 'Oil top-up needed'),
      ('t3', 'TL-002', 'Ladder 4m aluminium',     'Good',         'In store',    '',              '',                         NULL,         ''),
      ('t4', 'TL-008', 'Angle grinder 5"',        'Needs repair', 'In repair',   '',              '',                         NULL,         'Switch faulty — at Nakawa workshop'),
      ('t5', 'TL-031', 'Multimeter Fluke 117',    'Good',         'Checked out', 'Diana Achieng', 'JOB-00179 · Kololo rewire', '2026-09-30', ''),
      ('t6', 'TL-005', 'Concrete mixer 350L',     'Fair',         'In store',    '',              '',                         NULL,         'Serviced 12 Sep'),
      ('t7', 'TL-019', 'Tile cutter 900mm',       'Good',         'Checked out', 'Peter Ssali',   'JOB-00186 · Muyenga bath', '2026-10-02', '')
     ON CONFLICT (id) DO NOTHING`
  );

  await client.query(
    `INSERT INTO utility_captures (id, captured_on, type, reference, reading, amount, category_kind, captured_by, status) VALUES
      ('u1', '2026-09-28', 'Fuel',        'Shell Ntinda · 441882',       '42.5 L',             236000, 'direct',     'Moses Okello', 'Quarantined'),
      ('u2', '2026-09-27', 'Power',       'Yaka meter 0431 7719',        '1,284 → 1,412 kWh',  410000, 'operations', 'Grace Atim',   'Quarantined'),
      ('u3', '2026-09-26', 'Water',       'NWSC acct 88213',             '214 → 231 m³',       128000, 'operations', 'Grace Atim',   'Approved'),
      ('u4', '2026-09-25', 'Transport',   'Truck hire UBK 442H',         'Kololo run',         180000, 'direct',     'John Kato',    'Approved'),
      ('u5', '2026-09-24', 'Maintenance', 'Grinder repair TL-008',       'Workshop slip 118',  95000,  'operations', 'Grace Atim',   'Quarantined'),
      ('u6', '2026-09-22', 'Fuel',        'Total Kamwokya · 30219',      '31 L',               172000, 'direct',     'Diana Achieng', 'Rejected')
     ON CONFLICT (id) DO NOTHING`
  );
}
/**
 * Portal demo dataset (plan v5 Phase B client cut-over). Replaces the hard-coded
 * fixtures once in `gabfix-inhouse-erp/src/lib/portal-data.ts` (`jobs[]` and
 * `demoCostLines()`). Lives in the ledger so GET /api/data and
 * GET /api/employees/my-filings serve it to a signed-in technician, and the
 * dashboard renders it live rather than from a client array.
 *
 * Called from bootstrap-db.ts AFTER ensureStaff/ensureOwner, so the demo
 * employees (John/Grace/Peter/Gabriel) exist to own the filings. Idempotent
 * (ON CONFLICT / WHERE NOT EXISTS) and unconditional — a non-empty database still
 * picks the rows up on the next bootstrap, so re-seeding never dups rows.
 */
export async function seedPortalDemo(client: ClientBase): Promise<void> {
  const now = new Date();
  // Africa/Kampala is UTC+3 year-round (no DST). Anchor demo timestamps to the
  // current EAT day so filed costs/timesheets bucket into "this week" on the
  // portal's week strip instead of landing in a stale prior week.
  const eat = new Date(now.getTime() + 3 * 3600_000);
  const [y, mo, day] = [eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()];
  const dateStr = (dayOffset: number) =>
    new Date(Date.UTC(y, mo, day + dayOffset)).toISOString().slice(0, 10);
  // `h`/`min` are EAT wall-clock; subtract the +3 offset to get the UTC instant.
  const ts = (dayOffset: number, h: number, min: number) =>
    new Date(Date.UTC(y, mo, day + dayOffset, h - 3, min)).toISOString();

  const today = dateStr(0);
  const yesterday = dateStr(-1);
  const JOHN = '00000000-0000-4000-8000-000000000013';
  const GRACE = '00000000-0000-4000-8000-000000000010';
  const PETER = '00000000-0000-4000-8000-000000000014';
  const OWNER = '00000000-0000-4000-8000-000000000001';

  // ── Demo customers (namespaced ids — never collide with the JOB-00xxx seed set) ─
  await client.query(
    `INSERT INTO customers (id, name, company, type, phone, email, balance, status) VALUES
       ('cust-gf-sarah', 'Sarah Nanyonga',      'Sarah Nanyonga',      'Residential', '+256 772 200 401', 'sarah@gabfix.ug',        485000, 'Active'),
       ('cust-gf-mark',  'Mark Kato',           'Mark Kato',           'Residential', '+256 772 200 402', 'mark@gabfix.ug',         120000, 'Active'),
       ('cust-gf-acacia','Acacia Residences',   'Acacia Residences',   'Commercial',  '+256 772 200 403', 'ops@acaciaresidences.ug', 640000, 'Active'),
       ('cust-gf-nile',  'Nile Avenue Offices', 'Nile Avenue Offices', 'Commercial',  '+256 772 200 404', 'admin@nileavenue.ug',    950000, 'Active')
     ON CONFLICT (id) DO NOTHING`,
  );

  await client.query(
    `INSERT INTO services (id, name, division, method, price) VALUES
       ('svc-plumbing',   'Plumbing',   'Field', 'Fixed price', 0),
       ('svc-inspection', 'Inspection', 'Field', 'Fixed price', 0),
       ('svc-electrical', 'Electrical', 'Field', 'Fixed price', 0),
       ('svc-drainage',   'Drainage',   'Field', 'Fixed price', 0)
     ON CONFLICT (id) DO NOTHING`,
  );
    // __PORTAL_SEED_CONTINUE__
  // ── Demo jobs (GF-XXXX). Dashboard claims these via live PATCH /api/jobs/:id/status.
  // jobs.cost is seeded as the sum of the lines below (the costing service only
  // recomputes cost on writes, so the seed must set the right starting value).
  await client.query(`
    INSERT INTO jobs (id, number, customer_id, service_id, date, status, revenue, cost, assignees, equipment_usage, scheduled_date, started_at, completed_at, priority, site_address, salesperson_id, manager_id) VALUES
      ('GF-2841','GF-2841','cust-gf-sarah',  'svc-plumbing',   '${today}',      'In Progress', 285000, 98000,  ARRAY['John Kato']::TEXT[],                '[]'::jsonb, '${today}',      '${ts(0, 9, 0)}', NULL,            'High',   'Muyenga, Kampala',     '${PETER}', '${GRACE}'),
      ('GF-2846','GF-2846','cust-gf-mark',   'svc-inspection', '${today}',      'Scheduled',   120000, 37000,  ARRAY['John Kato']::TEXT[],                '[]'::jsonb, '${today}',      NULL,           NULL,            'Normal', 'Ntinda, Kampala',      '${PETER}', NULL),
      ('GF-2852','GF-2852','cust-gf-acacia', 'svc-electrical', '${today}',      'Scheduled',   640000, 237500, ARRAY['John Kato']::TEXT[],                '[]'::jsonb, '${today}',      NULL,           NULL,            'Normal', 'Kololo, Kampala',      '${PETER}', NULL),
      ('GF-2833','GF-2833','cust-gf-nile',   'svc-drainage',   '${yesterday}',  'Completed',   950000, 320000, ARRAY['John Kato','Grace Atim']::TEXT[], '[]'::jsonb, '${yesterday}', '${ts(-1, 10, 30)}', '${ts(-1, 16, 0)}', 'High',   'Central Kampala',      '${PETER}', '${GRACE}')
    ON CONFLICT (id) DO NOTHING`);

  // Crew assignments; accepted_at back-populated so "My jobs" shows them claimed.
  await client.query(`
    INSERT INTO job_assignments (job_id, employee_id, role, assigned_at, accepted_at) VALUES
      ('GF-2841','${JOHN}','technician','${ts(0, 8, 0)}','${ts(0, 8, 0)}'),
      ('GF-2846','${JOHN}','technician','${ts(0, 8, 0)}','${ts(0, 8, 0)}'),
      ('GF-2852','${JOHN}','technician','${ts(0, 8, 0)}','${ts(0, 8, 0)}'),
      ('GF-2833','${JOHN}','technician','${ts(-1, 9, 0)}','${ts(-1, 9, 0)}'),
      ('GF-2833','${GRACE}','lead','${ts(-1, 9, 0)}','${ts(-1, 9, 0)}')
    ON CONFLICT (job_id, employee_id) DO NOTHING`);

  // Demo field timecards — the approved row carries an approver; the open one doesn't.
  await client.query(
    `INSERT INTO timesheets (employee_id, job_id, started_at, ended_at, minutes, rate, approved_by)
     SELECT $1, $2, $3, $4, $5, $6, $7
     WHERE NOT EXISTS (SELECT 1 FROM timesheets WHERE job_id = $2 AND employee_id = $1 AND started_at = $3)`,
    [JOHN, 'GF-2841', ts(0, 9, 0), ts(0, 12, 30), 210, 0, null],
  );
  await client.query(
    `INSERT INTO timesheets (employee_id, job_id, started_at, ended_at, minutes, rate, approved_by)
     SELECT $1, $2, $3, $4, $5, $6, $7
     WHERE NOT EXISTS (SELECT 1 FROM timesheets WHERE job_id = $2 AND employee_id = $1 AND started_at = $3)`,
    [JOHN, 'GF-2852', ts(-1, 15, 0), ts(-1, 18, 0), 180, 0, OWNER],
  );

  // ── Demo cost lines (former demoCostLines()). An explicit amount wins over
  //    qty × unit cost — both are stored so the client preview and server total agree.
  const costLines = [
    { jobId: 'GF-2841', cat: 'cat-materials',   desc: 'Copper pipes + elbows (15mm)',         qty: 6, unit: 12500,  amount: 75000,  when: 0,  h: 9,  m: 20 },
    { jobId: 'GF-2852', cat: 'cat-materials',   desc: 'Heater element (3kW) + thermostat',    qty: 1, unit: 87500,  amount: 87500,  when: 0,  h: 11, m: 5 },
    { jobId: 'GF-2846', cat: 'cat-materials',   desc: 'PVC solvent cement + primer',          qty: 2, unit: 18500,  amount: 37000,  when: 0,  h: 14, m: 40 },
    { jobId: 'GF-2841', cat: 'cat-transport',   desc: 'Boda fare — parts run to Nakasero',     qty: null, unit: null, amount: 9000,  when: 0,  h: 16, m: 15 },
    { jobId: 'GF-2833', cat: 'cat-transport',   desc: 'Grab hire — drainage spoil removal',   qty: null, unit: null, amount: 320000, when: -1, h: 10, m: 30 },
    { jobId: 'GF-2852', cat: 'cat-subcontract', desc: 'Subcontract — electrician, half day',  qty: null, unit: null, amount: 150000, when: -5, h: 13, m: 10 },
    { jobId: 'GF-2841', cat: 'cat-materials',   desc: 'Thread seal tape + fittings sundries', qty: 4, unit: 3500,  amount: 14000,  when: -6, h: 8,  m: 45 },
  ];
  for (const c of costLines) {
    await client.query(
      `INSERT INTO job_costs (job_id, category_id, description, qty, unit_cost, amount, supplier_id, source, created_by, created_at)
       SELECT $1, $2, $3, $4, $5, $6, NULL, 'manual', $7, $8
       WHERE NOT EXISTS (SELECT 1 FROM job_costs WHERE job_id = $1 AND description = $3 AND amount = $6)`,
      [c.jobId, c.cat, c.desc, c.qty ?? 1, c.unit ?? 0, c.amount, JOHN, ts(c.when, c.h, c.m)],
    );
  }
}
