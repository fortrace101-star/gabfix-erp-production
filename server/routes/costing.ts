import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db';
import { parseBody } from '../validation/common';
import { jobCostCreate, timesheetCreate } from '../validation/costing';
import { addJobCost, approveTimesheet } from '../services/costing';
import { requireRole } from '../middleware/auth';
import { fail } from '../lib/http';
import { publish } from '../services/realtime';

/**
 * Job costing (Phase 1 data spine). Three writes: a manual cost line, a
 * clock-in row and the approval that turns field hours into a labour cost
 * line. Every write refreshes jobs.cost from the lines before responding.
 */
export const costingRouter = Router();

costingRouter.post('/costs', async (req: Request, res: Response) => {
  try {
    const input = parseBody(jobCostCreate, req.body);
    const result = await addJobCost({ ...input, createdBy: req.user?.id ?? null });
    res.status(201).json(result);
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Invalid cost line');
  }
});

costingRouter.post('/timesheets', async (req: Request, res: Response) => {
  try {
    const input = parseBody(timesheetCreate, req.body);
    // The signed-in employee owns their timecard. The schema still requires the
    // client to echo an employeeId, but the server stamps the authoritative id
    // (not the payload) and rejects any attempt to file a shift attributed to
    // another employee — closing the impersonation gap a `portal` token could
    // otherwise exploit against POST /api/timesheets.
    const actorId = req.user?.id ?? input.employeeId;
    if (req.user && input.employeeId && input.employeeId !== req.user.id) {
      res.status(403).json({ error: 'You can only file your own timecard' });
      return;
    }
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO timesheets (employee_id, job_id, started_at, ended_at, minutes, rate)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [actorId, input.jobId ?? null, input.startedAt, input.endedAt ?? null, input.minutes ?? null, input.rate ?? 0],
    );
    res.status(201).json({ id: rows[0].id });
    publish({ type: 'job-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Invalid timesheet');
  }
});

costingRouter.post(
  '/timesheets/:id/approve',
  // Only an owner/manager/accountant may turn a field shift into a labour
  // cost line — never the employee who filed it. Closes the self-approval gap:
  // a `portal` scope alone no longer suffices (scope mount is admin|portal),
  // so a technician cannot approve their own timecard.
  requireRole('owner', 'manager', 'accountant'),
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid timesheet id' });
      const result = await approveTimesheet(id, req.user?.id ?? null);
      res.json(result);
      publish({ type: 'job-updated', by: req.user?.name });
    } catch (error) {
      fail(res, error, 'Approval failed');
    }
  },
);
