import { useCallback, useEffect, useState } from "react";
import { portalApi } from "@/lib/api";
import { subscribeToJobEvents } from "@/lib/workspace";

/**
 * Role-dashboard data layer (plan: Sales / CSR / Supervisor panes).
 *
 * Reads ride GET /api/data (the `leads` / `followUps` / `interactions` /
 * `feedback` / `people` slices added by migration 021); writes go to
 * /api/crm/*. SSE (`job-updated`) refreshes the slice after any write, in any
 * app, so reminders highlight the moment they come due.
 */

export type LeadStage = "Lead" | "Contacted" | "Quoted" | "Negotiation" | "Won" | "Lost";

/** Workflow order — the Sales pane renders the pipeline in this sequence. */
export const LEAD_STAGES: LeadStage[] = [
  "Lead",
  "Contacted",
  "Quoted",
  "Negotiation",
  "Won",
  "Lost",
];
/** Stages that still count as "in the queue" (open pipeline). */
export const OPEN_STAGES: LeadStage[] = ["Lead", "Contacted", "Quoted", "Negotiation"];

export type Lead = {
  id: string;
  name: string;
  contact: string;
  company: string;
  phone: string;
  email: string;
  salespersonId: string | null;
  stage: LeadStage;
  value: number;
  source: string;
  nextFollowUpAt: string | null;
  convertedCustomerId: string | null;
  notes: string;
  createdAt: string;
};

export type FollowUpRow = {
  id: string;
  type: "client_follow_up" | "feedback_outreach";
  ownerEmployeeId: string | null;
  ownerRole: "sales" | "csr";
  customerId: string | null;
  leadId: string | null;
  jobId: string | null;
  notes: string;
  dueAt: string;
  status: "pending" | "done" | "skipped";
  followUpAfterDays: number;
  completedAt: string | null;
  createdAt: string;
};

export type InteractionRow = {
  id: string;
  customerId: string | null;
  leadId: string | null;
  jobId: string | null;
  employeeId: string | null;
  channel: "call" | "whatsapp" | "email" | "site" | "other";
  notes: string;
  outcome: string;
  nextFollowUpAt: string | null;
  createdAt: string;
};

export type FeedbackRow = {
  id: string;
  jobId: string | null;
  customerId: string | null;
  rating: number;
  comment: string;
  submittedAt: string;
};

export type PersonRow = { id: string; name: string; role: string };

export type CrmCustomer = {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  status: string;
  balance: number;
  salespersonId: string | null;
  lastContactedAt: string | null;
};

export type CrmJobRow = {
  id: string;
  number: string;
  customerId: string | null;
  serviceId: string | null;
  date: string;
  status: string;
  revenue: number;
  cost: number;
  assignees: string[];
  salespersonId: string | null;
  managerId: string | null;
};

type CrmPayload = {
  leads?: Lead[];
  followUps?: FollowUpRow[];
  interactions?: InteractionRow[];
  feedback?: FeedbackRow[];
  people?: PersonRow[];
  customers?: CrmCustomer[];
  jobs?: CrmJobRow[];
};

export type CrmData = {
  leads: Lead[];
  followUps: FollowUpRow[];
  interactions: InteractionRow[];
  feedback: FeedbackRow[];
  people: PersonRow[];
  customers: CrmCustomer[];
  jobs: CrmJobRow[];
  loaded: boolean;
  error: string;
  refresh: () => void;
};

/** The role-dashboard slice of GET /api/data, kept fresh over SSE. */
export function useCrmData(): CrmData {
  const [state, setState] = useState<Omit<CrmData, "refresh">>({
    leads: [],
    followUps: [],
    interactions: [],
    feedback: [],
    people: [],
    customers: [],
    jobs: [],
    loaded: false,
    error: "",
  });

  const load = useCallback(() => {
    portalApi
      .get<CrmPayload>("/data")
      .then((data) =>
        setState({
          leads: data.leads ?? [],
          followUps: data.followUps ?? [],
          interactions: data.interactions ?? [],
          feedback: data.feedback ?? [],
          people: data.people ?? [],
          customers: data.customers ?? [],
          jobs: data.jobs ?? [],
          loaded: true,
          error: "",
        }),
      )
      .catch((error: unknown) =>
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : "Could not load dashboard data",
        })),
      );
  }, []);

  useEffect(() => {
    load();
    return subscribeToJobEvents(load);
  }, [load]);

  return { ...state, refresh: load };
}

/* ── Writes ──────────────────────────────────────────────────────────────── */

export type LeadInput = {
  name: string;
  contact?: string | undefined;
  company?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  stage?: LeadStage | undefined;
  value?: number | undefined;
  source?: string | undefined;
  nextFollowUpAt?: string | undefined;
  notes?: string | undefined;
};

/** POST /api/crm/leads — enter a client into the workflow (attributed to me). */
export async function createLead(input: LeadInput): Promise<string> {
  const body = await portalApi.request<{ id: string }>("/crm/leads", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.id;
}

/** PATCH /api/crm/leads/:id — advance stage / set the next follow-up time. */
export async function updateLead(
  id: string,
  patch: {
    stage?: LeadStage | undefined;
    value?: number | undefined;
    nextFollowUpAt?: string | null | undefined;
    notes?: string | undefined;
  },
): Promise<void> {
  await portalApi.request(`/crm/leads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export type FollowUpInput = {
  type: "client_follow_up" | "feedback_outreach";
  customerId?: string | undefined;
  leadId?: string | undefined;
  jobId?: string | undefined;
  dueAt: string;
  notes?: string | undefined;
  followUpAfterDays?: number | undefined;
};

/** POST /api/crm/follow-ups — schedule a reminder at a date + time. */
export async function scheduleFollowUp(input: FollowUpInput): Promise<string> {
  const body = await portalApi.request<{ id: string }>("/crm/follow-ups", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.id;
}

/**
 * PATCH /api/crm/follow-ups/:id — complete/skip/snooze. For CSR feedback
 * outreach, completing without feedback re-queues the next touch in
 * `requeueDays` (default: the row's follow_up_after_days — the 2-day cadence).
 */
export async function updateFollowUp(
  id: string,
  patch: {
    status?: "pending" | "done" | "skipped" | undefined;
    dueAt?: string | undefined;
    notes?: string | undefined;
    requeueDays?: number | undefined;
  },
): Promise<void> {
  await portalApi.request(`/crm/follow-ups/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export type InteractionInput = {
  customerId?: string | undefined;
  leadId?: string | undefined;
  jobId?: string | undefined;
  channel?: "call" | "whatsapp" | "email" | "site" | "other" | undefined;
  notes: string;
  outcome?: string | undefined;
  nextFollowUpAt?: string | undefined;
};

/** POST /api/crm/interactions — log a contact (stamps last_contacted_at). */
export async function logInteraction(input: InteractionInput): Promise<string> {
  const body = await portalApi.request<{ id: string }>("/crm/interactions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return body.id;
}

/* ── Derived reads (pure — the panes compute KPIs from these) ────────────── */

export const isDue = (row: FollowUpRow, now: Date = new Date()): boolean =>
  row.status === "pending" && Date.parse(row.dueAt) <= now.getTime();

export const isDueToday = (row: FollowUpRow, now: Date = new Date()): boolean => {
  if (row.status !== "pending") return false;
  const due = Date.parse(row.dueAt);
  if (Number.isNaN(due)) return false;
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return due <= endOfDay.getTime();
};

/** "Overdue · 14:30" / "Today · 16:00" / "Fri · 09:00" for a due stamp. */
export function dueLabel(dueAt: string, now: Date = new Date()): string {
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return "No time set";
  const dueDate = new Date(due);
  const time = dueDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (due < startOfToday.getTime()) return `Overdue · ${time}`;
  const endOfDay = new Date(startOfToday);
  endOfDay.setDate(endOfDay.getDate() + 1);
  if (due < endOfDay.getTime()) return `Today · ${time}`;
  return `${dueDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}

/** Revenue attributed to a sales person, from their customers' jobs. */
export function revenueForSalesperson(jobs: CrmJobRow[], salespersonId: string | null): number {
  if (!salespersonId) return 0;
  return jobs
    .filter((job) => job.salespersonId === salespersonId && job.status !== "Quoted")
    .reduce((sum, job) => sum + (job.revenue ?? 0), 0);
}

/** Kampala day-key buckets for the week strip (same contract as costs/timesheets). */
export function weekRevenue(
  jobs: CrmJobRow[],
  dayKeys: string[],
  salespersonId: string | null,
): Array<{ dayKey: string; revenue: number }> {
  const byDay = new Map(dayKeys.map((dayKey) => [dayKey, 0]));
  for (const job of jobs) {
    if (salespersonId && job.salespersonId !== salespersonId) continue;
    if (!salespersonId) continue;
    const current = byDay.get(job.date);
    if (current !== undefined)
      byDay.set(job.date, current + (job.status === "Quoted" ? 0 : (job.revenue ?? 0)));
  }
  return dayKeys.map((dayKey) => ({ dayKey, revenue: byDay.get(dayKey) ?? 0 }));
}
