-- 022_employee_csr_role.sql
--
-- The CSR role (the portal's customer-service pane) was added to the server's
-- role lists — employees.ts, permission-matrix.ts, invites.ts, and the CRM
-- router's `owner_role` — but never to the database's own role constraint.
-- 005_multiapp_identity.sql already carried the widened list on disk, yet it had
-- long since been applied, and migrations run exactly once by name: an edited
-- applied file never reaches an existing database. The widening therefore ships
-- here instead, as its own additive file (the 017/018/019/020/021 convention).
--
-- Widening only: every previously valid role stays valid. Idempotent — the drop
-- is IF EXISTS and the add is a single deterministic constraint, so re-running
-- is a no-op (migrations are recorded, but a fresh database replays this once).

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_role_check;

ALTER TABLE employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('owner','manager','sales','technician','laundry','accountant','storekeeper','csr'));
