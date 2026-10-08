import { useCallback, useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { useSession } from "@/lib/session";

/**
 * Live-data layer (plan v5 D1): jobs assigned to the signed-in technician
 * from GET /api/data + lifecycle actions via PATCH /api/jobs/:id/status.
 */

type JobRow = {
  id: string;
  number: string;
  customerId: string | null;
  serviceId: string | null;
  date: string;
  status: string;
  revenue: number;
  cost: number;
  assignees: string[];
  siteAddress?: string | null;
};

export type PortalJob = {
  id: string;
  number: string;
  customer: string;
  service: string;
  place: string;
  status: string;
  date: string;
  revenue: number;
  mine: boolean;
};

type AssignmentRow = {
  jobId: string;
  employeeId: string;
  employeeName: string;
  role: string;
  assignedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  /** Widened by the server select (see server/db.ts job_assignments). */
  status?: string;
  revenue?: number;
};

/** UI-shaped rows for the CRM slices the portal renders per role. */
export type PortalLead = {
  id: string;
  name: string;
  stage: string;
  value: number;
  nextFollowUpAt: string | null;
  mine: boolean;
};

export type PortalFollowUp = {
  id: string;
  type: string;
  title: string;
  dueAt: string | null;
  status: string;
  notes: string | null;
};

export type PortalFeedback = {
  id: string;
  rating: number;
  comment: string;
  submittedAt: string | null;
  customer: string;
};

export type PortalCrewMember = {
  id: string;
  name: string;
  role: string;
  assigned: number;
  open: number;
  revenue: number;
};

export type EmployeeFeed = {
  jobs: PortalJob[];
  myJobs: PortalJob[];
  leads: PortalLead[];
  followUps: PortalFollowUp[];
  feedback: PortalFeedback[];
  crew: PortalCrewMember[];
  /** Catalogue pickers (proposal form): ids the server's FKs expect. */
  customers: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
};

type LeadRow = {
  id: string;
  name: string;
  company: string | null;
  salespersonId: string | null;
  stage: string;
  value: number;
  nextFollowUpAt: string | null;
};

type FollowUpRow = {
  id: string;
  type: string;
  ownerEmployeeId: string | null;
  ownerRole: string | null;
  customerId: string | null;
  leadId: string | null;
  jobId: string | null;
  notes: string | null;
  dueAt: string | null;
  status: string;
};

type FeedbackRow = {
  id: string;
  customerId: string | null;
  rating: number;
  comment: string | null;
  submittedAt: string | null;
};

type PersonRow = { id: string; name: string; role: string };

const OPEN_STATUSES = ['Quoted', 'Scheduled', 'In Progress'];

/**
 * Role-scoped workspace feed (plan A6/E1): one `GET /data` read shaped into the
 * slices a signed-in employee actually owns.
 *
 * Ownership mirrors the server's own boards: a job belongs to the employee
 * through `job_assignments`; a lead is theirs when it carries their
 * `salesperson_id` or is unassigned (anyone in the owning role may pick it up);
 * a follow-up likewise via `owner_employee_id`/`owner_role`. Nothing falls back
 * to demo data — the portal only ever renders associated state.
 */
export function useEmployeeWorkspace(
  employee: { id: string; role: string } | null,
): { feed: EmployeeFeed | null; error: string; reload: () => void } {
  const [feed, setFeed] = useState<EmployeeFeed | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    // Drop the previous identity's feed so nothing renders stale while loading.
    setFeed(null);
    setError('');
    const id = employee?.id ?? null;
    const role = (employee?.role ?? '').trim().toLowerCase();
    portalApi
      .get<{
        jobs: JobRow[];
        customers: Array<{ id: string; name: string }>;
        services: Array<{ id: string; name: string }>;
        jobAssignments?: AssignmentRow[];
        leads?: LeadRow[];
        followUps?: FollowUpRow[];
        feedback?: FeedbackRow[];
        people?: PersonRow[];
      }>('/data')
      .then((ws) => {
        if (!alive) return;
        const customerName = (cid: string | null | undefined) =>
          (cid ? ws.customers.find((c) => c.id === cid)?.name : null) ?? null;
        const leadById = new Map((ws.leads ?? []).map((l) => [l.id, l]));
        const mine = new Set(
          (ws.jobAssignments ?? []).filter((a) => a.employeeId === id).map((a) => a.jobId),
        );
        const jobs: PortalJob[] = ws.jobs.map((row) => ({
          id: row.id,
          number: row.number,
          customer: customerName(row.customerId) ?? 'Customer',
          service:
            (row.serviceId ? ws.services.find((s) => s.id === row.serviceId)?.name : null) ?? 'Service',
          place: row.siteAddress ?? '',
          status: row.status,
          date: row.date,
          revenue: row.revenue,
          mine: mine.has(row.id),
        }));

        const leads: PortalLead[] = (ws.leads ?? []).map((row) => ({
          id: row.id,
          name: row.company || row.name,
          stage: row.stage,
          value: row.value,
          nextFollowUpAt: row.nextFollowUpAt,
          mine: row.salespersonId === id,
        }));

        const followUps: PortalFollowUp[] = (ws.followUps ?? [])
          .filter((row) => {
            if (row.ownerEmployeeId) return row.ownerEmployeeId === id;
            return (row.ownerRole ?? '').trim().toLowerCase() === role;
          })
          .map((row) => ({
            id: row.id,
            type: row.type,
            title:
              (row.leadId ? leadById.get(row.leadId)?.name : null) ||
              customerName(row.customerId) ||
              row.jobId ||
              'Follow-up',
            dueAt: row.dueAt,
            status: row.status,
            notes: row.notes,
          }));

        const feedback: PortalFeedback[] = (ws.feedback ?? []).map((row) => ({
          id: row.id,
          rating: row.rating,
          comment: row.comment ?? '',
          submittedAt: row.submittedAt,
          customer: customerName(row.customerId) ?? 'Customer',
        }));

        // Team workload for the supervisor view, derived from assignment rows.
        const load = new Map<string, { assigned: number; open: number; revenue: number }>();
        for (const assignment of ws.jobAssignments ?? []) {
          const entry = load.get(assignment.employeeId) ?? { assigned: 0, open: 0, revenue: 0 };
          entry.assigned += 1;
          if (OPEN_STATUSES.includes(assignment.status ?? '')) entry.open += 1;
          entry.revenue += assignment.revenue ?? 0;
          load.set(assignment.employeeId, entry);
        }
        const crew: PortalCrewMember[] = (ws.people ?? []).map((person) => {
          const entry = load.get(person.id);
          return {
            id: person.id,
            name: person.name,
            role: person.role,
            assigned: entry?.assigned ?? 0,
            open: entry?.open ?? 0,
            revenue: entry?.revenue ?? 0,
          };
        });

        setFeed({
          jobs,
          myJobs: jobs.filter((job) => job.mine),
          leads,
          followUps,
          feedback,
          crew,
          customers: ws.customers,
          services: ws.services,
        });
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load your workspace');
      });
    return () => {
      alive = false;
    };
  }, [employee?.id, employee?.role, nonce]);

  return { feed, error, reload };
}

/**
 * Role-scoped job feed (plan D5): reads the workspace jobs slice from
 * GET /api/data and, when an employee id is supplied, scopes the result to the
 * jobs that employee is assigned to via `job_assignments` — the join table
 * migration 009 dual-writes alongside the legacy `assignees` text[] column.
 *
 * This replaces the previous name-substring heuristic: Technician's "My jobs"
 * now shows only crew-assigned jobs and the `mine` flag is exact. The optional
 * `employeeId` keeps `useJobOptions` (Timesheets/Costs picker) on the full job
 * list so its most-recent-job preselect stays intact.
 */
export function useMyJobs(employeeName: string | null, employeeId?: string | null) {
  const [jobs, setJobs] = useState<PortalJob[] | null>(null);
  const [error, setError] = useState("");
  const [assignedJobIds, setAssignedJobIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    // Identity/filter changed: drop the previous feed so consumers fall back
    // to their demo rows instead of briefly rendering another employee's jobs
    // while the scoped refetch is in flight.
    setJobs(null);
    setAssignedJobIds(new Set());
    portalApi
      .get<{
        jobs: JobRow[];
        customers: Array<{ id: string; name: string }>;
        services: Array<{ id: string; name: string }>;
        jobAssignments?: AssignmentRow[];
      }>("/data")
      .then((ws) => {
        if (!alive) return;
        const nameOf = (id: string | null) =>
          ws.customers.find((c) => c.id === id)?.name ?? "Customer";
        const serviceOf = (id: string | null) =>
          ws.services.find((s) => s.id === id)?.name ?? "Service";
        const myJobIds = new Set(
          (ws.jobAssignments ?? []).filter((a) => a.employeeId === employeeId).map((a) => a.jobId),
        );
        const mapped: PortalJob[] = ws.jobs.map((row) => ({
          id: row.id,
          number: row.number,
          customer: nameOf(row.customerId),
          service: serviceOf(row.serviceId),
          place: row.siteAddress ?? '',
          status: row.status,
          date: row.date,
          revenue: row.revenue,
          mine: myJobIds.has(row.id),
        }));
        setJobs(mapped);
        setAssignedJobIds(myJobIds);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load jobs");
      });
    return () => {
      alive = false;
    };
  }, [employeeName, employeeId]);

  return { jobs, error, assignedJobIds };
}

/** Lifecycle transition — the server stamps the timeline (D2). */
export async function setJobStatus(jobId: string, status: string): Promise<void> {
  await portalApi.request(`/jobs/${jobId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

/** SSE subscription: jobs change in any app → refresh here. */
export function subscribeToJobEvents(onChange: () => void): () => void {
  const base = portalApi.baseUrl;
  if (!base || typeof EventSource === "undefined") return () => undefined;
  const token = localStorage.getItem("gabfix:auth-token");
  const url = token ? `${base}/events?access_token=${encodeURIComponent(token)}` : `${base}/events`;
  const es = new EventSource(url);
  for (const type of ["job-created", "job-updated", "workspace-reset"]) {
    es.addEventListener(type, onChange);
  }
  return () => es.close();
}

/**
 * Job options for the filing forms (D3): the signed-in employee's job feed,
 * loaded once in the data layer so the Timesheets and Costs boards share it.
 */
export function useJobOptions(): Array<{ id: string; label: string }> {
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const { session } = useSession();
  const { jobs } = useMyJobs(session?.name ?? null);

  useEffect(() => {
    setOptions(
      (jobs ?? []).map((job) => ({ id: job.id, label: `${job.number} · ${job.customer}` })),
    );
  }, [jobs]);

  return options;
}
