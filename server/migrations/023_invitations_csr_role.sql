-- 023_invitations_csr_role.sql
--
-- Same trap as 022, one table over: 019_invitations.sql on disk already carries
-- 'csr' in invitations_role_check, but the file was edited after it had been
-- applied, and migrations run exactly once by name — an edited applied file
-- never reaches an existing database. The live database therefore still rejects
-- the csr role that the Admin Console's "Generate account creation code"
-- dialog offers (POST /api/invites failed with 'violates check constraint
-- "invitations_role_check"'), so the access control chosen at code-creation
-- time could not be baked into the code at all.
--
-- Widening only: every previously valid role stays valid. Idempotent — the drop
-- is IF EXISTS and the add is one deterministic constraint, so re-running is a
-- no-op (mirrors 022_employee_csr_role.sql).

ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;

ALTER TABLE invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('manager', 'sales', 'technician', 'laundry', 'accountant', 'storekeeper', 'csr'));
