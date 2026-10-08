import { useCallback, useEffect, useState } from "react";
import { portalApi } from "@/lib/api";

/**
 * Timesheets + job-cost capture (plan v5 D3) for the portal.
 *
 * POST /api/timesheets — clock a field shift (the server computes nothing:
 * minutes and rate are filed as reported; approval derives the labour cost).
 * POST /api/costs — one direct/sales cost line (amount wins over qty × unit).
 * GET /api/employees/my-filings — what the signed-in employee already filed.
 *
 * Live-data slice for the Timesheets and Costs boards: the demo toast is gone,
 * rows land in the ledger and the admin console sees them via job-updated SSE.
 */

export type Filing = {
  id: number | string;
  jobId: string | null;
  jobNumber: string | null;
  // timesheet rows
  startedAt?: string;
  endedAt?: string;
  minutes?: number | null;
  rate?: number;
  approved?: boolean;
  // cost rows
  description?: string;
  qty?: number;
  unitCost?: number;
  amount?: number;
  createdAt?: string;
};

export type MyFilings = {
  timesheets: Filing[];
  costs: Filing[];
};

export type TimesheetInput = {
  employeeId: string;
  jobId?: string;
  startedAt: string;
  endedAt?: string;
  minutes?: number;
  rate?: number;
};

export type CostInput = {
  jobId: string;
  description: string;
  // Pricing mirrors the server: an explicit amount wins, otherwise qty × unitCost.
  qty?: number;
  unitCost?: number;
  amount?: number;
};

export function useMyFilings(employeeId: string | undefined) {
  const [filings, setFilings] = useState<MyFilings>({ timesheets: [], costs: [] });
  const [loading, setLoading] = useState(Boolean(employeeId));
  // True at the first successful response — boards render their demo content
  // until then (the portal's demo-first contract), then hand over to live rows.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (!employeeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    portalApi
      .get<MyFilings>("/employees/my-filings")
      .then((rows) => {
        setFilings({ timesheets: rows.timesheets ?? [], costs: rows.costs ?? [] });
        setLoaded(true);
        setError("");
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not load your filings");
      })
      .finally(() => setLoading(false));
  }, [employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * `loaded` flips at the first successful response — boards show demo content
   * until then. `loading`/`error` let them render refresh notes and a retry
   * instead of a blank list.
   */
  return { filings, refresh: load, loading, error, loaded };
}

/** POST /api/timesheets — minutes may be derived client-side from the range. */
export async function fileTimesheet(input: TimesheetInput): Promise<void> {
  const body: Record<string, unknown> = { ...input };
  if (!input.endedAt) delete body["endedAt"];
  if (!input.minutes) delete body["minutes"];
  if (!input.rate) delete body["rate"];
  if (!input.jobId) delete body["jobId"];
  await portalApi.request("/timesheets", { method: "POST", body: JSON.stringify(body) });
}

/** POST /api/costs — a manual cost line against a job. */
export async function fileCost(input: CostInput): Promise<void> {
  await portalApi.request("/costs", { method: "POST", body: JSON.stringify(input) });
}

/** Whole minutes between two ISO timestamps (inclusive of partial minutes). */
export function minutesBetween(startedAt: string, endedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}
