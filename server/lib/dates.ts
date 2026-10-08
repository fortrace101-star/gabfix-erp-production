/**
 * Africa/Kampala date handling (Phase 0.9, plan section 8.7).
 *
 * The business runs on Uganda time (UTC+3, no DST). Every "business date" —
 * an expense recorded at 01:00, a maintenance flag, a job date — must resolve
 * to the Kampala calendar day, not the UTC day (which lags by three hours and
 * flips to yesterday between 00:00 and 03:00 local time).
 *
 * Dates are passed around as YYYY-MM-DD strings (the shape PostgreSQL DATE
 * columns and the HTML date inputs already use) so no timezone information is
 * ever lost or reinterpreted in transit.
 */

export const KAMPALA_TZ = 'Africa/Kampala';

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: KAMPALA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Africa/Kampala as YYYY-MM-DD (en-CA formats as ISO). */
export function kampalaToday(now: Date = new Date()): string {
  return dayFormatter.format(now);
}

/**
 * Calendar arithmetic on a YYYY-MM-DD string: addDays('2026-09-30', 1) is
 * '2026-10-01' and addDays('2027-01-01', -1) is '2026-12-31'. Uses UTC math on
 * the already-resolved local date so no timezone can shift the result.
 */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Maintenance is due when the scheduled day is today or earlier, compared on
 * Kampala day boundaries — a machine due '2026-09-26' is due from 00:00 local,
 * even though UTC noon is still 2026-09-26T09:00.
 */
export function isMaintenanceDue(nextMaintenance: string | null | undefined, today: string = kampalaToday()): boolean {
  return typeof nextMaintenance === 'string' && nextMaintenance.length > 0 && nextMaintenance <= today;
}
