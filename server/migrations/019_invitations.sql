-- 019_invitations.sql
-- Admin-issued, app-scoped, single-use invite codes (plan v5 B3 extension).
--
-- Replaces ad-hoc per-account creation with an auditable onboarding ticket: an
-- admin (owner, or a manager for non-admin apps) generates a short code that
-- carries a role + an app_scope subset of {admin,laundry,portal,store} plus an
-- expiry. A new hire's Sign Up on any app consumes the code (single use) to
-- create their employee with EXACTLY the code's grants. The sign-up body
-- cannot escalate role or app_scope beyond what the code authorised — see
-- routes/auth.ts (sign-up) and routes/invites.ts.
--
-- Usable = unused + unrevoked + unexpired; the invitations_usable_idx partial
-- index keeps validate/sign-up O(log n) instead of a sequential scan.
CREATE TABLE IF NOT EXISTS invitations (
  code TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('manager', 'sales', 'technician', 'laundry', 'accountant', 'storekeeper', 'csr')),
  app_scope TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
  used_by UUID REFERENCES employees(id),
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT invitations_app_scope_check
    CHECK (app_scope <@ ARRAY['admin', 'laundry', 'portal', 'store']::TEXT[])
);

-- Partial index over unused + unrevoked codes (cheap, indexable). The expiry
-- check stays in the queries' WHERE at runtime (> now()); it cannot live in an
-- index predicate because now() is not marked IMMUTABLE.
CREATE INDEX IF NOT EXISTS invitations_usable_idx
  ON invitations (code)
  WHERE used_at IS NULL AND revoked_at IS NULL;