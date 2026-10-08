import { minutesBetween, type Filing } from "@/lib/filings";

/**
 * Timesheet maths for the portal's Timesheets page (plan v5 D3).
 *
 * Everything here is pure, so the board can filter, sort, total and chart the
 * shifts it already fetched without another round-trip. Calendar days are
 * Kampala days: the server stores `timestamptz` and stamps documents in
 * Africa/Kampala, so a shift filed at 23:30 EAT belongs to that EAT date — not
 * to the UTC date the ISO string happens to start on.
 */

export const KAMPALA_TIME_ZONE = "Africa/Kampala";

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: KAMPALA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: KAMPALA_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const weekdayShort = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" });
const dayMedium = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayLong = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dayOfMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** Kampala calendar day (YYYY-MM-DD) for a timestamp; "" when unparseable. */
export function kampalaDayKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const parts = dayKeyFormat.formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Kampala wall clock for a timestamp, e.g. "08:15"; "—" when unparseable. */
export function timeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return timeFormat.format(date);
}

/** Device-local `datetime-local` value ("YYYY-MM-DDTHH:mm") for an instant. */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Day keys are plain strings, so their arithmetic runs in UTC — no DST edges. */
function dayKeyToUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export function addDays(dayKey: string, days: number): string {
  const date = dayKeyToUtc(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(dayKey: string): number {
  return (dayKeyToUtc(dayKey).getUTCDay() + 6) % 7;
}

/** Monday of the week that holds `dayKey`. */
export function startOfWeek(dayKey: string): string {
  return addDays(dayKey, -weekdayIndex(dayKey));
}

/** Monday → Sunday day keys for the week that holds `dayKey`. */
export function weekDays(dayKey: string): string[] {
  const monday = startOfWeek(dayKey);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** "Mon" — the week strip's column label. */
export function weekdayName(dayKey: string): string {
  return dayKey ? weekdayShort.format(dayKeyToUtc(dayKey)) : "—";
}

/** "Wed, 24 Sep" — table rows and chips. */
export function dayMediumLabel(dayKey: string): string {
  return dayKey ? dayMedium.format(dayKeyToUtc(dayKey)) : "—";
}

/** "Wednesday, 24 September 2026" — modal headlines. */
export function dayLongLabel(dayKey: string): string {
  return dayKey ? dayLong.format(dayKeyToUtc(dayKey)) : "—";
}

/** "22 – 28 Sep 2026" — the panel headline for a Mon–Sun week. */
export function weekLabel(anchorDayKey: string): string {
  if (!anchorDayKey) return "—";
  const days = weekDays(anchorDayKey);
  const last = dayKeyToUtc(days[6] ?? anchorDayKey);
  return `${dayKeyToUtc(days[0] ?? anchorDayKey).getUTCDate()} – ${dayOfMonth.format(last)}`;
}

/** Minutes a filed shift covers: filed minutes win, else derived from the range. */
export function shiftMinutes(row: Filing): number {
  if (typeof row.minutes === "number" && row.minutes > 0) return row.minutes;
  if (row.startedAt && row.endedAt) return minutesBetween(row.startedAt, row.endedAt);
  return 0;
}

/** A shift with no end time is still running (or was filed open on purpose). */
export function isOpenShift(row: Filing): boolean {
  return !row.endedAt;
}

/** What the shift costs the job at the filed rate (approval posts this line). */
export function shiftValue(row: Filing): number {
  return Math.round((shiftMinutes(row) / 60) * (row.rate ?? 0));
}

/** "7h 30m" · "45m" · "—" when nothing was recorded. */
export function hoursLabel(minutes: number): string {
  if (!minutes || minutes < 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export type ShiftStatusFilter = "all" | "pending" | "approved";
export type ShiftSortKey = "startedAt" | "hours" | "value";
export type ShiftSort = { key: ShiftSortKey; dir: "asc" | "desc" };

/** The toolbar's filters, applied in one pass (each narrows the previous). */
export function filterShifts(
  rows: Filing[],
  filters: {
    status?: ShiftStatusFilter | undefined;
    jobId?: string | undefined;
    dayKey?: string | undefined;
  },
): Filing[] {
  const status = filters.status ?? "all";
  return rows.filter((row) => {
    if (status === "approved" && !row.approved) return false;
    if (status === "pending" && row.approved) return false;
    if (filters.jobId && row.jobId !== filters.jobId) return false;
    if (filters.dayKey && kampalaDayKey(row.startedAt) !== filters.dayKey) return false;
    return true;
  });
}

export function sortShifts(rows: Filing[], sort: ShiftSort): Filing[] {
  const direction = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === right) return 0;
    return left < right ? -direction : direction;
  });
}

function sortValue(row: Filing, key: ShiftSortKey): number {
  if (key === "hours") return shiftMinutes(row);
  if (key === "value") return shiftValue(row);
  const parsed = Date.parse(row.startedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export type ShiftTotals = { shifts: number; minutes: number; value: number };

export type ShiftSummary = {
  shifts: number;
  minutes: number;
  value: number;
  approved: ShiftTotals;
  pending: ShiftTotals;
  openShifts: number;
  missingRate: number;
  todayMinutes: number;
  weekShifts: number;
  weekMinutes: number;
  weekValue: number;
};

/** One roll-up for the KPI strip: totals, approval split and week-to-date. */
export function summarizeShifts(rows: Filing[], anchorDayKey: string): ShiftSummary {
  const week = new Set(weekDays(anchorDayKey));
  const totals = (): ShiftTotals => ({ shifts: 0, minutes: 0, value: 0 });
  const summary: ShiftSummary = {
    shifts: rows.length,
    minutes: 0,
    value: 0,
    approved: totals(),
    pending: totals(),
    openShifts: 0,
    missingRate: 0,
    todayMinutes: 0,
    weekShifts: 0,
    weekMinutes: 0,
    weekValue: 0,
  };
  for (const row of rows) {
    const minutes = shiftMinutes(row);
    const value = shiftValue(row);
    summary.minutes += minutes;
    summary.value += value;
    const bucket = row.approved ? summary.approved : summary.pending;
    bucket.shifts += 1;
    bucket.minutes += minutes;
    bucket.value += value;
    if (isOpenShift(row)) summary.openShifts += 1;
    if (!row.rate) summary.missingRate += 1;
    const day = kampalaDayKey(row.startedAt);
    if (day === anchorDayKey) summary.todayMinutes += minutes;
    if (week.has(day)) {
      summary.weekShifts += 1;
      summary.weekMinutes += minutes;
      summary.weekValue += value;
    }
  }
  return summary;
}

export type WeekBucket = { dayKey: string; shifts: number; minutes: number; value: number };

/** Mon–Sun buckets for the week strip; the strip scales bars off the peak. */
export function weekBuckets(rows: Filing[], anchorDayKey: string): WeekBucket[] {
  const buckets = weekDays(anchorDayKey).map((dayKey) => ({
    dayKey,
    shifts: 0,
    minutes: 0,
    value: 0,
  }));
  const byDay = new Map(buckets.map((bucket) => [bucket.dayKey, bucket]));
  for (const row of rows) {
    const bucket = byDay.get(kampalaDayKey(row.startedAt));
    if (!bucket) continue;
    bucket.shifts += 1;
    bucket.minutes += shiftMinutes(row);
    bucket.value += shiftValue(row);
  }
  return buckets;
}

/** Jobs that already appear in the filings — the toolbar's job filter. */
export function jobFilterOptions(rows: Filing[]): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!row.jobId || seen.has(row.jobId)) continue;
    seen.set(row.jobId, row.jobNumber ?? "Job");
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

function toMillis(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * The filed shift a new range would sit on top of, if any. Non-blocking: field
 * hands do split a day across jobs, so the form warns instead of refusing.
 */
export function clashFor(
  rows: Filing[],
  startedAt: string,
  endedAt: string | null | undefined,
): Filing | null {
  const start = toMillis(startedAt);
  if (!Number.isFinite(start)) return null;
  const end = toMillis(endedAt ?? null);
  const newEnd = Number.isFinite(end) ? end : start;
  for (const row of rows) {
    const otherStart = toMillis(row.startedAt);
    if (!Number.isFinite(otherStart)) continue;
    const otherEnd = row.endedAt ? toMillis(row.endedAt) : otherStart + shiftMinutes(row) * 60_000;
    if (start < otherEnd && newEnd > otherStart) return row;
  }
  return null;
}

/** The Log-shift form's values (all strings — they come straight off inputs). */
export type ShiftDraft = { jobId: string; startedAt: string; endedAt: string; rate: string };

/**
 * Sensible starting values: the previous shift's job, rate and clock times moved
 * to today, or a zeroed four-hour block for a first-ever shift.
 */
export function defaultShiftDraft(rows: Filing[], now: Date = new Date()): ShiftDraft {
  const todayKey = kampalaDayKey(now) || toLocalInput(now).slice(0, 10);
  const lastRate = rows.find((row) => (row.rate ?? 0) > 0)?.rate ?? 0;
  const rate = lastRate ? String(lastRate) : "";
  const previous = rows.find((row) => row.startedAt && row.endedAt);
  if (previous?.startedAt && previous.endedAt) {
    const startedAt = `${todayKey}T${timeLabel(previous.startedAt)}`;
    const endedAt = `${todayKey}T${timeLabel(previous.endedAt)}`;
    return { jobId: previous.jobId ?? "", startedAt, endedAt, rate };
  }
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  return { jobId: "", startedAt: toLocalInput(start), endedAt: toLocalInput(end), rate };
}

/** "Log a similar shift": the same clock times and rate, moved to today. */
export function duplicateDraft(row: Filing, now: Date = new Date()): ShiftDraft {
  const todayKey = kampalaDayKey(now) || toLocalInput(now).slice(0, 10);
  const start = timeLabel(row.startedAt);
  const end = row.endedAt ? timeLabel(row.endedAt) : "";
  return {
    jobId: row.jobId ?? "",
    startedAt: `${todayKey}T${start === "—" ? "08:00" : start}`,
    endedAt: end && end !== "—" ? `${todayKey}T${end}` : "",
    rate: row.rate ? String(row.rate) : "",
  };
}
