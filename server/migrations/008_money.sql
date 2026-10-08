-- 008_money.sql (plan's "005_money.sql", renumbered to the next free file
-- in this repo; Phase 1 data spine — payments + double-entry ledger).
--
-- One concern: the money tables. chart_of_accounts seeds the minimal
-- double-entry skeleton the ledger service posts against; payment_methods
-- seeds the manual capture methods the owner uses today (cash, MTN MoMo,
-- Airtel Money, bank, cheque), each pointing at the float/cash account its
-- money lands in; journal entries/lines hold the postings themselves. The
-- payments table records money in/out against invoices, laundry orders or
-- jobs, with method, reference and receipt number (locked decision: manual
-- capture now, gateway later behind the same table).
--
-- Additive only; safe to re-run. Balances on invoices/customers are
-- recomputed by the payments service after each post (plan §1 exit criteria:
-- "a recorded payment moves invoice status, customer balance, journal and
-- cash flow together").

-- ── Chart of accounts (minimal skeleton, extended in later slices) ─────────
-- Created first: payment_methods.gl_account_code references it below.
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_code TEXT REFERENCES chart_of_accounts(code),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO chart_of_accounts (code, name, type) VALUES
  ('1000', 'Cash on hand',            'asset'),
  ('1010', 'Mobile money float',      'asset'),
  ('1020', 'Bank account',            'asset'),
  ('1100', 'Accounts receivable',     'asset'),
  ('2000', 'Accounts payable',        'liability'),
  ('3000', 'Owner equity',            'equity'),
  ('4000', 'Service revenue',         'income'),
  ('4100', 'Laundry revenue',         'income'),
  ('5000', 'Direct costs',            'expense'),
  ('6000', 'Operating expenses',      'expense')
ON CONFLICT (code) DO NOTHING;

-- ── Payment methods ────────────────────────────────────────────────────────
-- gl_account_code names the asset account money captured through this method
-- lands in: cash -> 1000, mobile money -> 1010, bank/cheque -> 1020.
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cash', 'momo', 'bank', 'card', 'cheque', 'other')),
  provider TEXT,
  gl_account_code TEXT REFERENCES chart_of_accounts(code),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO payment_methods (id, name, kind, gl_account_code) VALUES
  ('pm-cash',  'Cash',              'cash',   '1000'),
  ('pm-mtn',   'MTN MoMo',          'momo',   '1010'),
  ('pm-airtel','Airtel Money',      'momo',   '1010'),
  ('pm-bank',  'Bank transfer',     'bank',   '1020'),
  ('pm-cheque','Cheque',            'cheque', '1020')
ON CONFLICT (id) DO NOTHING;

-- ── Payments ───────────────────────────────────────────────────────────────
-- direction 'in' = money the business received, 'out' = money paid out
-- (supplier refunds, expenses settled from float). A payment points at
-- exactly one document when it moves customer money.
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  customer_id TEXT REFERENCES customers(id),
  method_id TEXT REFERENCES payment_methods(id),
  amount DOUBLE PRECISION NOT NULL CHECK (amount <> 0),
  currency TEXT NOT NULL DEFAULT 'UGX',
  reference TEXT NOT NULL DEFAULT '',
  invoice_id TEXT REFERENCES invoices(id),
  laundry_order_id TEXT REFERENCES laundry_orders(id),
  job_id TEXT REFERENCES jobs(id),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gateway_ref TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'reconciled', 'voided')),
  recorded_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CHECK (num_nonnulls(invoice_id, laundry_order_id, job_id) <= 1)
);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON payments(invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS payments_customer_idx ON payments(customer_id) WHERE deleted_at IS NULL;

-- ── Journal ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_id TEXT,
  posted_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_by TEXT
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id BIGSERIAL PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
  debit DOUBLE PRECISION NOT NULL DEFAULT 0,
  credit DOUBLE PRECISION NOT NULL DEFAULT 0,
  customer_id TEXT,
  job_id TEXT,
  employee_id TEXT,
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx ON journal_lines(entry_id);

-- Keep updated_at honest on every table the runner already touches.
DROP TRIGGER IF EXISTS chart_of_accounts_touch ON chart_of_accounts;
CREATE TRIGGER chart_of_accounts_touch BEFORE UPDATE ON chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS payment_methods_touch ON payment_methods;
CREATE TRIGGER payment_methods_touch BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS payments_touch ON payments;
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS journal_entries_touch ON journal_entries;
CREATE TRIGGER journal_entries_touch BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- PAY / JNL sequences were reserved in 004; make sure they exist for
-- databases created before that reservation and start above any imported
-- payment or journal numbers (backups must not cause reuse).
INSERT INTO document_sequences (key, prefix, width, next_value) VALUES
  ('payment', 'PAY', 5, 1),
  ('journal', 'JNL', 5, 1)
ON CONFLICT (key) DO NOTHING;

DO $$
BEGIN
  UPDATE document_sequences s SET next_value = GREATEST(s.next_value, sub.max_n + 1)
  FROM (
    SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '^PAY-0*', ''), '')::int), 0) AS max_n, 'payment' AS key
    FROM payments
  ) sub WHERE s.key = sub.key;

  UPDATE document_sequences s SET next_value = GREATEST(s.next_value, sub.max_n + 1)
  FROM (
    SELECT COALESCE(MAX(NULLIF(regexp_replace(number, '^JNL-0*', ''), '')::int), 0) AS max_n, 'journal' AS key
    FROM journal_entries
  ) sub WHERE s.key = sub.key;
END $$;
