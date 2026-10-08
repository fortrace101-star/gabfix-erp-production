import { useEffect, useState } from "react";

/**
 * Concern categories (plan §2.3 / §12-#2): the kinds a field lead can attach
 * when raising a concern on a job. Mirrors the server `job_queries.kind`
 * CHECK constraint so the portal and staff API stay in lockstep.
 */
export const CONCERN_KINDS = [
  "wrong_job",
  "schedule_conflict",
  "missing_kit",
  "safety",
  "other",
] as const;
export type ConcernKind = (typeof CONCERN_KINDS)[number];

export const CONCERN_LABELS: Record<ConcernKind, string> = {
  wrong_job: "Wrong job",
  schedule_conflict: "Schedule conflict",
  missing_kit: "Missing kit",
  safety: "Safety",
  other: "Other",
};

export type JobConcernStatus = "open" | "resolved";

/** UI-shaped row for a raised concern (plan §2.3 = `job_queries`). */
export interface JobConcern {
  id: string;
  jobId: string;
  jobNumber: string;
  customer: string;
  kind: ConcernKind;
  body: string;
  raisedBy: string;
  raisedById: string;
  status: JobConcernStatus;
  resolution: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RaiseConcernInput {
  jobId: string;
  jobNumber: string;
  customer: string;
  kind: ConcernKind;
  body: string;
  raisedBy: string;
  raisedById: string;
}

/**
 * Preview store (AGENTS.md: preview data lives in the portal UI until the staff
 * API is connected). Real rows come from `GET /api/job-queries`; in this
 * workspace the bell/API aren't reachable, so the inbox seeds two samples and
 * persists anything raised here. A real wire-up would swap the I/O, not this API.
 */
const STORAGE_KEY = "gabfix:preview:job_queries";

const sampleConcerns: JobConcern[] = [
  {
    id: "q_1",
    jobId: "job_33",
    jobNumber: "GF-2841",
    customer: "Sarah Nanyonga",
    kind: "missing_kit",
    body: "Pressure tester wasn't loaded on the van this morning.",
    raisedBy: "Daniel Okello",
    raisedById: "emp_12",
    status: "open",
    resolution: null,
    resolvedBy: null,
    createdAt: new Date(Date.now() - 1_200_000).toISOString(),
    resolvedAt: null,
  },
  {
    id: "q_2",
    jobId: "job_31",
    jobNumber: "GF-2852",
    customer: "Acacia Residences",
    kind: "schedule_conflict",
    body: "Two crews double-booked for the 15:00 slot; one crew is waiting.",
    raisedBy: "Daniel Okello",
    raisedById: "emp_12",
    status: "open",
    resolution: null,
    resolvedBy: null,
    createdAt: new Date(Date.now() - 840_000).toISOString(),
    resolvedAt: null,
  },
];

function readAll(): JobConcern[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sampleConcerns;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as JobConcern[]) : sampleConcerns;
  } catch {
    return sampleConcerns;
  }
}

function persist(rows: JobConcern[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* quota / unavailable — keep going with in-memory samples */
  }
}

/** Open concerns, newest first. */
export function listOpenConcerns(): JobConcern[] {
  return readAll()
    .filter((c) => c.status === "open")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function allConcerns(): JobConcern[] {
  return readAll().sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function raiseConcern(input: RaiseConcernInput): JobConcern {
  const row: JobConcern = {
    ...input,
    id: `q_${Date.now().toString(36)}`,
    status: "open",
    resolution: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
  };
  persist([row, ...readAll()]);
  dispatchPreviewEvent(row);
  return row;
}

export function resolveConcern(
  id: string,
  resolution: string,
  resolvedBy: string,
): JobConcern | null {
  const rows = readAll();
  const idx = rows.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  rows[idx] = {
    ...rows[idx],
    status: "resolved",
    resolution,
    resolvedBy,
    resolvedAt: now,
  };
  persist(rows);
  dispatchPreviewEvent(rows[idx]);
  return rows[idx];
}

/**
 * In-preview broadcast so the bell/toast layer and the manager inbox can react
 * to a freshly raised concern without a live SSE bus (the server path is wired
 * in PortalBell; this is the offline preview shim).
 */
export function dispatchPreviewEvent(row: JobConcern) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("gabfix:preview-concern", { detail: row }),
  );
}

/** React hook: open concerns live + hot on the preview broadcast. */
export function useConcerns() {
  const [items, setItems] = useState<JobConcern[]>(() => listOpenConcerns());
  const reload = () => setItems(listOpenConcerns());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const on = () => reload();
    window.addEventListener("gabfix:preview-concern", on);
    return () => window.removeEventListener("gabfix:preview-concern", on);
  }, []);
  return { items, reload };
}
