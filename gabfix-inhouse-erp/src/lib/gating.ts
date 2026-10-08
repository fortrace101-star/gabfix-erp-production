/**
 * Checklist gating policy (plan §6 / §12-#1).
 *
 * Field-stage transitions (Inspection, Quoted, Scheduled, In Progress, Follow-up)
 * are *advisory*: the crew may proceed with an explicit "skip" that gets logged
 * to the job activity log. Only the terminal `Closed` transition is a *hard*
 * gate — the server returns 422 until every item is ticked or individually
 * waived.
 *
 * The portal only drives field-stage actions, so it surfaces the advisory path
 * (skip with a logged note) and delegates the hard terminal gate to the staff
 * API. `mode === 'hard'` is still returned here so the same rule travels with
 * the row when the `Closed` transition is attempted.
 */

export const FIELD_STAGES: readonly string[] = [
  "Inspection",
  "Quoted",
  "Scheduled",
  "In Progress",
  "Follow-up",
];

export const TERMINAL_STAGES: readonly string[] = [
  "Completed",
  "Invoiced",
  "Paid",
  "Closed",
  "Cancelled",
];

export type GateMode = "advisory" | "hard";

export interface GateReport {
  /** `advisory` for field stages (skip allowed / logged), `hard` for terminal. */
  mode: GateMode;
  /** True once every item is done (or the stage has no items). */
  ready: boolean;
  done: number;
  total: number;
  remaining: number;
  /** Human reason surfaced in the drawer. */
  reason: string;
}

/**
 * Decide whether a checkout on the given stage can proceed, and under which
 * policy. Pure: no React, no I/O.
 */
export function checklistGate(
  stage: string,
  done: number,
  total: number,
): GateReport {
  const mode: GateMode = TERMINAL_STAGES.includes(stage) ? "hard" : "advisory";
  const remaining = Math.max(0, total - done);
  const ready = total === 0 || done >= total;
  let reason: string;
  if (ready) {
    reason = "Checklist complete";
  } else if (mode === "hard") {
    reason =
      "Terminal stage — every checklist item must be ticked or individually waived before closing.";
  } else {
    reason = `${remaining} unchecked ${remaining === 1 ? "item" : "items"} — finish them, or log a skip to proceed.`;
  }
  return { mode, ready, done, total, remaining, reason };
}
