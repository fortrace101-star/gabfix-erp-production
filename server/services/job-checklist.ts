import type { PoolClient } from 'pg';

/**
 * Job checklists + activity log.
 *
 * A job owns one checklist per stage it passes through. "Inspection" is seeded
 * the first time the checklist is read for a job, so every job — however old —
 * starts with it; each further stage seeds when the job enters that stage (see
 * routes/job-status.ts). Items stay editable the whole way through: crew add
 * what the template missed, tick work off, remove what does not apply.
 *
 * `job_activities` is the catch-all: anything that happened but never made it
 * into the system (a site surprise, a call, parts swapped) can be written
 * against the stage it belongs to, before or after the fact.
 */

/** Stage order used for display; anything else keeps its own label after these. */
export const STAGE_ORDER = [
  'Inspection',
  'Quoted',
  'Scheduled',
  'In Progress',
  'Completed',
  'Invoiced',
  'Paid',
] as const;

/** The checklist seeded for each stage when a job enters it. */
export const STAGE_CHECKLISTS: Record<string, string[]> = {
  Inspection: [
    'Walk the site and note hazards / access',
    'Confirm the scope with the customer',
    'Photograph the current condition',
    'List the tools and materials needed',
    'Record anything unusual the crew must know',
  ],
  Quoted: ['Confirm measurements', 'Price check against the rate card', 'Quote sent to the customer'],
  Scheduled: [
    'Confirm crew and equipment',
    'Share the job brief with the crew',
    'Confirm customer availability',
    'Load materials and spares',
  ],
  'In Progress': [
    'Record start time',
    'Complete the agreed scope',
    'Log materials and extra work used',
    'Photograph before / after',
    'Capture the customer sign-off',
  ],
  Completed: [
    'Timesheet submitted',
    'Costs and expenses filed',
    'Photos attached to the job record',
    'Follow-up or feedback call scheduled',
  ],
  Invoiced: ['Invoice raised', 'Payment terms shared with the customer'],
  Paid: ['Payment received and reconciled'],
};

export type ChecklistItem = {
  id: string;
  stage: string;
  label: string;
  position: number;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
};

export type JobActivity = {
  id: string;
  stage: string;
  body: string;
  employeeId: string | null;
  employeeName: string | null;
  createdAt: string;
};

const stageRank = (stage: string): number => {
  const index = (STAGE_ORDER as readonly string[]).indexOf(stage);
  return index === -1 ? STAGE_ORDER.length : index;
};

/**
 * Seed a stage's template for a job. Idempotent: skips the stage entirely once
 * it has any rows, so crew edits are never overwritten by a later stage entry.
 */
export async function seedStageChecklist(
  client: PoolClient,
  jobId: string,
  stage: string,
  createdBy: string | null = null,
): Promise<void> {
  const labels = STAGE_CHECKLISTS[stage];
  if (!labels) return;
  const existing = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM job_checklist_items WHERE job_id = $1 AND stage = $2`,
    [jobId, stage],
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  for (const [position, label] of labels.entries()) {
    await client.query(
      `INSERT INTO job_checklist_items (job_id, stage, label, position, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, stage, label, position, createdBy],
    );
  }
}

/** Ensure a job has its opening "Inspection" checklist (works for old jobs too). */
export async function ensureInspectionChecklist(
  client: PoolClient,
  jobId: string,
  createdBy: string | null = null,
): Promise<void> {
  await seedStageChecklist(client, jobId, 'Inspection', createdBy);
}

/** The job's whole checklist in stage order, plus the done/total count. */
export async function listChecklist(
  client: PoolClient,
  jobId: string,
): Promise<{ items: ChecklistItem[]; total: number; done: number }> {
  const { rows } = await client.query<ChecklistItem>(
    `SELECT id, stage, label, position, done, done_at::text AS "doneAt", created_at::text AS "createdAt"
     FROM job_checklist_items WHERE job_id = $1`,
    [jobId],
  );
  const items = rows.sort(
    (a, b) => stageRank(a.stage) - stageRank(b.stage) || a.position - b.position,
  );
  return { items, total: items.length, done: items.filter((item) => item.done).length };
}

export async function addChecklistItem(
  client: PoolClient,
  args: { jobId: string; stage: string; label: string; employeeId: string | null },
): Promise<ChecklistItem> {
  const next = await client.query<{ next: string }>(
    `SELECT COALESCE(max(position), -1) + 1 AS next FROM job_checklist_items WHERE job_id = $1 AND stage = $2`,
    [args.jobId, args.stage],
  );
  const { rows } = await client.query<ChecklistItem>(
    `INSERT INTO job_checklist_items (job_id, stage, label, position, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, stage, label, position, done, done_at::text AS "doneAt", created_at::text AS "createdAt"`,
    [args.jobId, args.stage, args.label, Number(next.rows[0]?.next ?? 0), args.employeeId],
  );
  return rows[0]!;
}

/** Tick / untick, and optionally relabel, one checklist item. */
export async function updateChecklistItem(
  client: PoolClient,
  args: { jobId: string; itemId: string; done?: boolean; label?: string; employeeId: string | null },
): Promise<ChecklistItem | null> {
  const { rows } = await client.query<ChecklistItem>(
    `UPDATE job_checklist_items
        SET done = COALESCE($3, done),
            done_at = CASE WHEN $3 IS TRUE THEN now() WHEN $3 IS FALSE THEN NULL ELSE done_at END,
            done_by = CASE WHEN $3 IS NOT NULL THEN $5::uuid ELSE done_by END,
            label = COALESCE($4, label)
      WHERE id = $2 AND job_id = $1
      RETURNING id, stage, label, position, done, done_at::text AS "doneAt", created_at::text AS "createdAt"`,
    [args.jobId, args.itemId, args.done ?? null, args.label ?? null, args.employeeId],
  );
  return rows[0] ?? null;
}

export async function deleteChecklistItem(
  client: PoolClient,
  args: { jobId: string; itemId: string },
): Promise<boolean> {
  const { rowCount } = await client.query(
    `DELETE FROM job_checklist_items WHERE id = $2 AND job_id = $1`,
    [args.jobId, args.itemId],
  );
  return (rowCount ?? 0) > 0;
}

export async function listActivities(client: PoolClient, jobId: string): Promise<JobActivity[]> {
  const { rows } = await client.query<JobActivity>(
    `SELECT a.id, a.stage, a.body, a.employee_id::text AS "employeeId",
            e.name AS "employeeName", a.created_at::text AS "createdAt"
     FROM job_activities a
     LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.job_id = $1
     ORDER BY a.created_at DESC`,
    [jobId],
  );
  return rows;
}

export async function addActivity(
  client: PoolClient,
  args: { jobId: string; stage: string; body: string; employeeId: string | null },
): Promise<JobActivity> {
  const { rows } = await client.query<JobActivity>(
    `INSERT INTO job_activities (job_id, stage, body, employee_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, stage, body, employee_id::text AS "employeeId",
               NULL::text AS "employeeName", created_at::text AS "createdAt"`,
    [args.jobId, args.stage, args.body, args.employeeId],
  );
  return rows[0]!;
}