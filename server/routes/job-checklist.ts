import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { parseBody } from '../validation/common';
import { can } from './permission-matrix';
import {
  addActivity,
  addChecklistItem,
  deleteChecklistItem,
  ensureInspectionChecklist,
  listActivities,
  listChecklist,
  updateChecklistItem,
} from '../services/job-checklist';
import { publish } from '../services/realtime';

/**
 * Per-stage job checklists + the job activity log.
 *
 *   GET    /api/jobs/:id/checklist          — every stage's items, done/total
 *   POST   /api/jobs/:id/checklist          — add an item { stage, label }
 *   PATCH  /api/jobs/:id/checklist/:itemId  — tick/untick, relabel
 *   DELETE /api/jobs/:id/checklist/:itemId  — remove an item that does not apply
 *   GET    /api/jobs/:id/activities         — the activity log, newest first
 *   POST   /api/jobs/:id/activities         — capture work, incl. late/forgotten
 *
 * Anyone assigned to the job may edit it; roles holding `assign_crew` (owners,
 * managers) may edit any job. Reads are open to every signed-in app that can see
 * jobs, so the Admin console reads the same checklist the crew fills in.
 */

export const jobChecklistRouter = Router();

type Actor = { id?: string; name?: string; role?: string };

const itemCreate = z.strictObject({
  stage: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
});

const itemPatch = z.strictObject({
  done: z.boolean().optional(),
  label: z.string().trim().min(1).max(200).optional(),
});

const activityCreate = z.strictObject({
  stage: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(2000),
});

/** Assigned crew edit freely; anyone with `assign_crew` edits any job. */
async function assertCanEdit(jobId: string, actor: Actor): Promise<boolean> {
  if (can(actor.role ?? '', 'assign_crew')) return true;
  if (!actor.id) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM job_assignments WHERE job_id = $1 AND employee_id = $2::uuid`,
    [jobId, actor.id],
  );
  return rows.length > 0;
}

async function jobExists(jobId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM jobs WHERE id = $1`, [jobId]);
  return rows.length > 0;
}

jobChecklistRouter.get('/:id/checklist', async (req: Request, res: Response) => {
  const actor: Actor = (req as Request & { user?: Actor }).user ?? {};
  try {
    if (!(await jobExists(String(req.params.id)))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const client = await pool.connect();
    try {
      // Every job — old or new — starts with its Inspection checklist.
      await ensureInspectionChecklist(client, String(req.params.id), actor.id ?? null);
      res.json(await listChecklist(client, String(req.params.id)));
    } finally {
      client.release();
    }
  } catch (error) {
    fail(res, error, 'Could not load the job checklist');
  }
});

jobChecklistRouter.post('/:id/checklist', async (req: Request, res: Response) => {
  const actor: Actor = (req as Request & { user?: Actor }).user ?? {};
  try {
    if (!(await jobExists(String(req.params.id)))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (!(await assertCanEdit(String(req.params.id), actor))) {
      res.status(403).json({ error: 'Only the assigned crew or a manager may edit this job' });
      return;
    }
    const input = parseBody(itemCreate, req.body);
    const client = await pool.connect();
    try {
      const item = await addChecklistItem(client, {
        jobId: String(req.params.id),
        stage: input.stage,
        label: input.label,
        employeeId: actor.id ?? null,
      });
      res.status(201).json(item);
    } finally {
      client.release();
    }
    publish({ type: 'job-updated', by: actor.name });
  } catch (error) {
    fail(res, error, 'Could not add the checklist item');
  }
});

jobChecklistRouter.patch('/:id/checklist/:itemId', async (req: Request, res: Response) => {
  const actor: Actor = (req as Request & { user?: Actor }).user ?? {};
  try {
    if (!(await assertCanEdit(String(req.params.id), actor))) {
      res.status(403).json({ error: 'Only the assigned crew or a manager may edit this job' });
      return;
    }
    const input = parseBody(itemPatch, req.body);
    if (input.done === undefined && input.label === undefined) {
      res.status(422).json({ error: 'Nothing to change' });
      return;
    }
    const client = await pool.connect();
    try {
      const item = await updateChecklistItem(client, {
        jobId: String(req.params.id),
        itemId: String(req.params.itemId),
        done: input.done,
        label: input.label,
        employeeId: actor.id ?? null,
      });
      if (!item) {
        res.status(404).json({ error: 'Checklist item not found' });
        return;
      }
      res.json(item);
    } finally {
      client.release();
    }
    publish({ type: 'job-updated', by: actor.name });
  } catch (error) {
    fail(res, error, 'Could not update the checklist item');
  }
});

jobChecklistRouter.delete('/:id/checklist/:itemId', async (req: Request, res: Response) => {
  const actor: Actor = (req as Request & { user?: Actor }).user ?? {};
  try {
    if (!(await assertCanEdit(String(req.params.id), actor))) {
      res.status(403).json({ error: 'Only the assigned crew or a manager may edit this job' });
      return;
    }
    const client = await pool.connect();
    try {
      const removed = await deleteChecklistItem(client, { jobId: String(req.params.id), itemId: String(req.params.itemId) });
      if (!removed) {
        res.status(404).json({ error: 'Checklist item not found' });
        return;
      }
    } finally {
      client.release();
    }
    res.json({ removed: true });
    publish({ type: 'job-updated', by: actor.name });
  } catch (error) {
    fail(res, error, 'Could not remove the checklist item');
  }
});

jobChecklistRouter.get('/:id/activities', async (req: Request, res: Response) => {
  try {
    if (!(await jobExists(String(req.params.id)))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const client = await pool.connect();
    try {
      res.json(await listActivities(client, String(req.params.id)));
    } finally {
      client.release();
    }
  } catch (error) {
    fail(res, error, 'Could not load the job activity log');
  }
});

jobChecklistRouter.post('/:id/activities', async (req: Request, res: Response) => {
  const actor: Actor = (req as Request & { user?: Actor }).user ?? {};
  try {
    if (!(await jobExists(String(req.params.id)))) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    if (!(await assertCanEdit(String(req.params.id), actor))) {
      res.status(403).json({ error: 'Only the assigned crew or a manager may log work on this job' });
      return;
    }
    const input = parseBody(activityCreate, req.body);
    const client = await pool.connect();
    try {
      const activity = await addActivity(client, {
        jobId: String(req.params.id),
        stage: input.stage,
        body: input.body,
        employeeId: actor.id ?? null,
      });
      res.status(201).json(activity);
    } finally {
      client.release();
    }
    publish({ type: 'job-updated', by: actor.name });
  } catch (error) {
    fail(res, error, 'Could not log the job activity');
  }
});