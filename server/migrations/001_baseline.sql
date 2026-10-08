-- 001_baseline.sql
-- The current schema, frozen as the starting point for every environment.
-- Copied verbatim from the former server/schema.sql at baseline commit 100d0aa.
-- Rules for future files: NNN_snake_case.sql, one concern per file, additive only,
-- and safe to re-run where practical (see docs/plans/enhance.md, Appendix C).

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'Residential',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  balance NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT 'Other Services',
  method TEXT NOT NULL DEFAULT 'Fixed price',
  price NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled',
  revenue NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  assignees TEXT[] NOT NULL DEFAULT '{}',
  equipment_usage JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  date DATE NOT NULL,
  due DATE NOT NULL,
  total NUMERIC NOT NULL DEFAULT 0,
  paid NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Unpaid'
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  date DATE NOT NULL,
  division TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS laundry_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'Washing',
  total NUMERIC NOT NULL DEFAULT 0,
  paid NUMERIC NOT NULL DEFAULT 0,
  items TEXT NOT NULL DEFAULT '',
  received DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Washing machine',
  branch_id TEXT NOT NULL REFERENCES branches(id),
  value NUMERIC NOT NULL DEFAULT 0,
  book_value NUMERIC NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT 'Good',
  next_maintenance DATE NOT NULL,
  usage NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  quantity NUMERIC NOT NULL DEFAULT 0,
  minimum NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  branch_id TEXT NOT NULL REFERENCES branches(id)
);