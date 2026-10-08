import { type Filing } from "@/lib/filings";
import { kampalaDayKey, weekDays } from "@/lib/timesheet";

/**
 * Job-cost line maths for the portal's Costs page (plan v5 D3).
 *
 * Everything here is pure so the board can filter, sort, total and chart the
 * cost lines it already fetched without another round-trip. The pricing rule
 * mirrors the server (`server/services/costing.ts`): an explicit amount wins
 * over quantity × unit cost, and the product is rounded to two decimals —
 * otherwise the form preview would disagree with what lands on the job.
 *
 * Dates follow the same Kampala-day convention as `lib/timesheet.ts`: a line
 * filed at 23:30 EAT belongs to that EAT date, not to the UTC date its ISO
 * string happens to start on.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** amount wins over qty × unitCost, exactly like the server computes it. */
export function costAmount(row: Filing): number {
  if (typeof row.amount === "number") return row.amount;
  return round2((row.qty ?? 1) * (row.unitCost ?? 0));
}

/**
 * "120k" · "1.5m" · "850" — compact money for the week strip's bars, where a
 * full "UGX 120,000" would overflow the column. "—" when nothing was filed.
 */
export function shortMoney(value: number): string {
  if (!value || value < 0) return "—";
  const trim = (scaled: number) => String(Math.round(scaled * 10) / 10).replace(/\.0$/, "");
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}m`;
  if (value >= 1_000) return `${trim(value / 1_000)}k`;
  return String(Math.round(value));
}

export type CostSummary = {
  lines: number;
  totalValue: number;
  todayLines: number;
  todayValue: number;
  weekLines: number;
  weekValue: number;
  jobs: number;
};

/** One roll-up for the KPI strip: totals, today and the Mon–Sun week. */
export function summarizeCosts(rows: Filing[], anchorDayKey: string): CostSummary {
  const week = new Set(weekDays(anchorDayKey));
  const summary: CostSummary = {
    lines: rows.length,
    totalValue: 0,
    todayLines: 0,
    todayValue: 0,
    weekLines: 0,
    weekValue: 0,
    jobs: 0,
  };
  const jobs = new Set<string>();
  for (const row of rows) {
    const value = costAmount(row);
    summary.totalValue += value;
    if (row.jobId) jobs.add(row.jobId);
    const day = kampalaDayKey(row.createdAt);
    if (day === anchorDayKey) {
      summary.todayLines += 1;
      summary.todayValue += value;
    }
    if (week.has(day)) {
      summary.weekLines += 1;
      summary.weekValue += value;
    }
  }
  summary.jobs = jobs.size;
  return summary;
}

export type CostWeekBucket = { dayKey: string; lines: number; value: number };

/** Mon–Sun buckets for the week strip; the strip scales bars off the peak. */
export function costWeekBuckets(rows: Filing[], anchorDayKey: string): CostWeekBucket[] {
  const buckets = weekDays(anchorDayKey).map((dayKey) => ({ dayKey, lines: 0, value: 0 }));
  const byDay = new Map(buckets.map((bucket) => [bucket.dayKey, bucket]));
  for (const row of rows) {
    const bucket = byDay.get(kampalaDayKey(row.createdAt));
    if (!bucket) continue;
    bucket.lines += 1;
    bucket.value += costAmount(row);
  }
  return buckets;
}

export type CostSortKey = "createdAt" | "amount" | "job";
export type CostSort = { key: CostSortKey; dir: "asc" | "desc" };

/** The toolbar's filters, applied in one pass (each narrows the previous). */
export function filterCosts(
  rows: Filing[],
  filters: {
    jobId?: string | undefined;
    dayKey?: string | undefined;
    query?: string | undefined;
  },
): Filing[] {
  const query = (filters.query ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.jobId && row.jobId !== filters.jobId) return false;
    if (filters.dayKey && kampalaDayKey(row.createdAt) !== filters.dayKey) return false;
    if (query) {
      const haystack = `${row.description ?? ""} ${row.jobNumber ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function sortCosts(rows: Filing[], sort: CostSort): Filing[] {
  const direction = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort.key === "job") {
      const left = (a.jobNumber ?? "").toLowerCase();
      const right = (b.jobNumber ?? "").toLowerCase();
      if (left === right) return 0;
      return (left < right ? -1 : 1) * direction;
    }
    const left = costSortValue(a, sort.key);
    const right = costSortValue(b, sort.key);
    if (left === right) return 0;
    return (left < right ? -1 : 1) * direction;
  });
}

function costSortValue(row: Filing, key: Exclude<CostSortKey, "job">): number {
  if (key === "amount") return costAmount(row);
  const parsed = Date.parse(row.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The Log-cost form's values (all strings — they come straight off inputs). */
export type CostDraft = {
  jobId: string;
  description: string;
  qty: string;
  unit: string;
  amount: string;
};

/**
 * Sensible starting values: the job of your most recent line (you are probably
 * still buying for it), everything else empty so nothing posts by accident.
 */
export function defaultCostDraft(rows: Filing[]): CostDraft {
  return {
    jobId: rows.find((row) => row.jobId)?.jobId ?? "",
    description: "",
    qty: "",
    unit: "",
    amount: "",
  };
}

/** "File another like this": the same job, description and pricing, ready to edit. */
export function duplicateCostDraft(row: Filing): CostDraft {
  const unit = row.unitCost ?? 0;
  const qty = row.qty ?? 0;
  const amount = row.amount ?? 0;
  const derived = round2((qty || 1) * unit);
  const unitPriced = unit > 0 && amount > 0 && Math.abs(derived - amount) < 0.005;
  return {
    jobId: row.jobId ?? "",
    description: row.description ?? "",
    qty: qty > 0 ? String(qty) : "",
    unit: unit > 0 ? String(unit) : "",
    // A unit-priced line leaves the amount empty so editing the quantity
    // re-derives it instead of silently keeping the old total.
    amount: unitPriced || amount <= 0 ? "" : String(amount),
  };
}

export type CostPreview = {
  /** What the server will store as the line's amount. */
  amount: number;
  source: "amount" | "qty";
  qty: number;
  unitCost: number;
};

/**
 * The modal's live pricing: an explicit amount wins, otherwise quantity × unit
 * cost (quantity defaults to 1, like the server). `null` while the form has
 * nothing to price — the same state the server rejects with 422.
 */
export function previewCostDraft(draft: CostDraft): CostPreview | null {
  const amount = Number(draft.amount) || 0;
  const unit = Number(draft.unit) || 0;
  const qty = Number(draft.qty) || 0;
  if (amount > 0) return { amount: round2(amount), source: "amount", qty, unitCost: unit };
  if (unit > 0) {
    const effectiveQty = qty > 0 ? qty : 1;
    return {
      amount: round2(effectiveQty * unit),
      source: "qty",
      qty: effectiveQty,
      unitCost: unit,
    };
  }
  return null;
}
