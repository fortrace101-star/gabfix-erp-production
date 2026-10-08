import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { parseBody } from "../validation/common";
import { fail } from "../lib/http";
import { dispatchEvent } from "../services/notifications";
import { publish } from "../services/realtime";
import { can, CAPABILITY_ROLES } from "../routes/permission-matrix";

/** Name-only staff list for crew pickers — safe for every signed-in app. */
export const assignableEmployeesRouter = Router();

assignableEmployeesRouter.get(
  "/assignable",
  async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT id::text AS id, name, role FROM employees WHERE deleted_at IS NULL ORDER BY name`,
      );
      res.json(rows);
    } catch (error) {
      fail(res, error, "Could not load staff list");
    }
  },
);

/**
 * My filed documents (plan v5 D3): the signed-in employee's timesheets and
 * job-cost lines, newest first, so the portal's Timesheets/Costs boards show
 * what actually landed rather than a toast.
 */
assignableEmployeesRouter.get(
  "/my-filings",
  async (req: Request, res: Response) => {
    try {
      const employeeId = req.user?.id ?? "";
      if (!employeeId) {
        res.json({ timesheets: [], costs: [] });
        return;
      }
      const timesheets = await pool.query(
        `SELECT t.id, t.job_id AS "jobId", j.number AS "jobNumber",
              t.started_at::text AS "startedAt", t.ended_at::text AS "endedAt",
              t.minutes, t.rate::float8 AS rate,
              (t.approved_by IS NOT NULL) AS approved
       FROM timesheets t LEFT JOIN jobs j ON j.id = t.job_id
       WHERE t.employee_id = $1::uuid
       ORDER BY t.started_at DESC LIMIT 20`,
        [employeeId],
      );
      const costs = await pool.query(
        `SELECT c.id, c.job_id AS "jobId", j.number AS "jobNumber", c.description,
              c.qty::float8 AS qty, c.unit_cost::float8 AS "unitCost",
              c.amount::float8 AS amount, c.created_at::text AS "createdAt"
       FROM job_costs c LEFT JOIN jobs j ON j.id = c.job_id
       WHERE c.created_by = $1::uuid
       ORDER BY c.created_at DESC LIMIT 20`,
        [employeeId],
      );
      res.json({ timesheets: timesheets.rows, costs: costs.rows });
    } catch (error) {
      fail(res, error, "Could not load filings");
    }
  },
);

/**
 * Job crew assignments (plan v5 F3 dependency).
 *
 * Assignments used to live only in the admin's assignees[] text column; the
 * notification rule needs real rows. Two writes:
 *
 *   GET  /api/jobs/:id/assignments — crew list (id, name, role, stamps)
 *   POST /api/jobs/:id/assignments — add a crew member → dispatches
 *                                    job.assigned → portal bell
 *   DELETE /api/jobs/:id/assignments/:employeeId — remove (no bell)
 *
 * plus GET /api/employees/assignable — a name-only list any signed-in app can
 * read for pickers (the full /api/employees stays owner/manager-gated).
 */
export const assignmentsRouter = Router();

const ASSIGNMENT_ROLES = [
  "technician",
  "lead",
  "assistant",
  "salesperson",
] as const;

const assignmentCreate = z.strictObject({
  employeeId: z.string().uuid(),
  role: z.enum(ASSIGNMENT_ROLES).optional(),
});

assignmentsRouter.get(
  "/:id/assignments",
  async (req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.employee_id::text AS "employeeId", e.name, a.role,
              a.assigned_at::text AS "assignedAt",
              a.accepted_at::text AS "acceptedAt",
              a.completed_at::text AS "completedAt"
       FROM job_assignments a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.job_id = $1
       ORDER BY a.assigned_at, e.name`,
        [req.params.id],
      );
      res.json(rows);
    } catch (error) {
      fail(res, error, "Could not load assignments");
    }
  },
);

assignmentsRouter.post(
  "/:id/assignments",
  async (req: Request, res: Response) => {
    const actor = (req as Request & { user?: { role?: string } }).user;
    if (!actor || !can(actor.role ?? "", "assign_crew")) {
      res.status(403).json({ error: "Only permitted roles may assign crew" });
      return;
    }
    let input: z.infer<typeof assignmentCreate>;
    try {
      input = parseBody(assignmentCreate, req.body);
    } catch (error) {
      fail(res, error, "Assignment failed");
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query<{ id: string; number: string }>(
        `SELECT id, number FROM jobs WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      );
      if (!job.rows.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Job not found" });
        return;
      }
      const { rows } = await client.query(
        `INSERT INTO job_assignments (job_id, employee_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (job_id, employee_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING employee_id::text AS "employeeId", role`,
        [job.rows[0].id, input.employeeId, input.role ?? "technician"],
      );
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
      publish({ type: "job-updated", by: req.user?.name });
      try {
        const c = await pool.connect();
        try {
          await dispatchEvent(c, {
            type: "job.assigned",
            entityType: "jobs",
            entityId: job.rows[0].id,
          });
        } finally {
          c.release();
        }
      } catch {
        // The assignment stands even if the bell could not be queued.
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      fail(res, error, "Assignment failed");
    } finally {
      client.release();
    }
  },
);

assignmentsRouter.delete(
  "/:id/assignments/:employeeId",
  async (req: Request, res: Response) => {
    const actor = (req as Request & { user?: { role?: string } }).user;
    if (!actor || !can(actor.role ?? "", "assign_crew")) {
      res.status(403).json({ error: "Only permitted roles may remove crew" });
      return;
    }
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM job_assignments WHERE job_id = $1 AND employee_id = $2::uuid`,
        [req.params.id, req.params.employeeId],
      );
      if (!rowCount) {
        res.status(404).json({ error: "Assignment not found" });
        return;
      }
      res.json({ removed: rowCount });
      publish({ type: "job-updated", by: req.user?.name });
    } catch (error) {
      fail(res, error, "Could not remove assignment");
    }
  },
);
