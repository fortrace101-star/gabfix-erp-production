import express from 'express';
import { pool } from '../db';
import { fail } from '../lib/http';

/**
 * Permission matrix: which roles may hold which capabilities.
 *
 *   owner    -> everything (and can delegate to anyone)
 *   manager  -> can grant/revoke access to app_scope, manage employees (not owners)
 *   sales    -> cannot manage access; can read finance/customer data only
 *   technician/laundry/storekeeper/accountant -> app-scoped execution only
 *
 * Decisions that are "done" vs "needs a user call":
 *   - who may reassign a job's crew ('assign_crew') is a role decision.
 *   - who may grant app_scope to a new employee is a control-plane decision.
 *   Both are enforced here, not in the UI.
 */
export const ROLES = [
  'owner', 'manager', 'sales', 'technician', 'laundry', 'storekeeper', 'accountant', 'csr',
] as const;

/** Capability -> roles that are allowed to do it. */
export const CAPABILITY_ROLES: Record<string, string[]> = {
  assign_crew: ['owner', 'manager', 'technician', 'laundry', 'storekeeper', 'accountant', 'csr'],
  view_reports: ['owner', 'manager', 'technician', 'laundry', 'storekeeper', 'accountant', 'sales', 'csr'],
  manage_employees: ['owner', 'manager'],
  manage_access: ['owner', 'manager'],
  // Customer support capability: CSRs handle customer leads and service requests.
  // Sales hold it too — the Sales pane enters clients into the `leads` workflow.
  handle_leads: ['owner', 'manager', 'csr', 'sales'],
  review_feedback: ['owner', 'manager', 'csr'],
  // Order lifecycle (plan: cleaning-operations-workflow.md §3).
  // Proposing happens in the Portal (salesperson relays a client's request;
  // customer support may create one on a client's behalf).
  create_proposals: ['owner', 'manager', 'csr', 'sales'],
  // Confirm = phone verification. Salespeople may never confirm their own
  // proposal — "the only way into Confirmed" is manager or customer support.
  confirm_orders: ['owner', 'manager', 'csr'],
  // Closing is customer support's terminal action; it needs feedback first.
  close_orders: ['owner', 'manager', 'csr'],
  // Cancellation is manager-only, and never after Completed (server-enforced).
  cancel_orders: ['owner', 'manager'],
};

export function can(actorRole: string, capability: string): boolean {
  const allowed = CAPABILITY_ROLES[capability];
  if (!allowed) return false;
  if (actorRole === 'owner') return true;
  return allowed.includes(actorRole);
}

export function router() {
const router = express.Router();

  router.get('/capabilities', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT e.id, e.role, e.name, e.app_scope, e.active
         FROM employees e WHERE e.deleted_at IS NULL ORDER BY e.role = 'owner' DESC, e.role, e.name`,
      );
      const capabilities: Record<string, { access: string[]; manager: boolean }> = {};
      for (const row of rows) {
        const id = String(row.id ?? '');
        const caps: Record<string, boolean> = {};
        for (const [cap, roles] of Object.entries(CAPABILITY_ROLES)) {
          caps[cap] = roles.includes(row.role);
        }
        capabilities[id] = { access: Object.keys(caps), manager: caps['manage_access'] ?? false };
      }
      res.json({ capabilities });
    } catch (error) {
      fail(res, error, 'Could not load permission matrix');
    }
  });

  return router;
}
