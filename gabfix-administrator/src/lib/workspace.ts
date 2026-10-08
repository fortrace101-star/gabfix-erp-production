import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";

/**
 * Live-data slice (plan A6): one real collection from GET /api/data drives the
 * console's KPI strip. Phase B/G replaces the remaining demo arrays.
 */

type Workspace = {
  jobs: Array<{ id: string; status: string; revenue: number; cost: number }>;
  payments: Array<{ amount: number; direction: string }>;
  customers: unknown[];
};

const money = (value: number) =>
  `UGX ${(value / 1_000_000).toLocaleString("en-UG", { maximumFractionDigits: 1 })}M`;

export function useWorkspaceMetrics() {
  const [metrics, setMetrics] = useState<{ revenue: string | null; activeJobs: number | null }>({
    revenue: null,
    activeJobs: null,
  });

  useEffect(() => {
    let alive = true;
    apiClient
      .get<Workspace>("/data")
      .then((ws) => {
        if (!alive) return;
        const revenue = ws.payments
          .filter((p) => p.direction === "in")
          .reduce((sum, p) => sum + p.amount, 0);
        const activeJobs = ws.jobs.filter(
          (j) => j.status !== "Completed" && j.status !== "Cancelled",
        ).length;
        setMetrics({
          revenue: revenue > 0 ? money(revenue) : null,
          activeJobs: activeJobs > 0 ? activeJobs : null,
        });
      })
      .catch(() => {
        if (alive) setMetrics({ revenue: null, activeJobs: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  return metrics;
}
