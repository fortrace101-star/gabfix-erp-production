import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, UsersRound, TrendingUp, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dueLabel,
  isDue,
  updateFollowUp,
  useCrmData,
  type FollowUpRow,
  type PersonRow,
} from "@/lib/crm";
import { kampalaDayKey } from "@/lib/timesheet";
import { KpiStrip, money } from "./shared";

/**
 * Supervisor panes: "My day" (team performance table + team reminders +
 * escalations) and the fuller "Team" board. Team rows are computed from the
 * people feed + jobs/follow-ups slices — one shared source filtered per the
 * supervisory view. Actions are real: completing/snoozing a team reminder
 * writes through /api/crm (server checks `handle_leads`, held by managers).
 */

const CLOSED_STATUSES = new Set(["Completed", "Invoiced", "Paid"]);

type TeamRow = {
  person: PersonRow;
  jobsToday: number;
  revenue: number;
  openFollowUps: number;
  dueNow: number;
};

function useTeam(employeeId: string | null): {
  crm: ReturnType<typeof useCrmData>;
  rows: TeamRow[];
} {
  const crm = useCrmData();
  const rows = useMemo<TeamRow[]>(() => {
    const today = kampalaDayKey(new Date());
    return crm.people
      .filter((person) => person.id !== employeeId)
      .map((person) => {
        const owned = crm.jobs.filter(
          (job) =>
            job.salespersonId === person.id ||
            job.managerId === person.id ||
            job.assignees.includes(person.name),
        );
        const followUps = crm.followUps.filter(
          (row) =>
            row.status === "pending" &&
            (row.ownerEmployeeId === person.id ||
              (row.ownerEmployeeId === null && row.ownerRole === person.role)),
        );
        return {
          person,
          jobsToday: owned.filter((job) => job.date === today).length,
          revenue: owned
            .filter((job) => CLOSED_STATUSES.has(job.status))
            .reduce((sum, job) => sum + (job.revenue ?? 0), 0),
          openFollowUps: followUps.length,
          dueNow: followUps.filter((row) => isDue(row)).length,
        };
      });
  }, [crm.people, crm.jobs, crm.followUps, employeeId]);
  return { crm, rows };
}

/* ── My day ─────────────────────────────────────────────────────────────── */

export function SupervisorDay({ employeeId }: { employeeId: string | null }) {
  const { crm, rows } = useTeam(employeeId);
  const [busyId, setBusyId] = useState("");

  const today = kampalaDayKey(new Date());
  const teamJobsToday = rows.reduce((sum, row) => sum + row.jobsToday, 0);
  const teamRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const teamDue = rows.reduce((sum, row) => sum + row.dueNow, 0);
  const openFollowUps = crm.followUps.filter((row) => row.status === "pending");
  const overdue = openFollowUps.filter((row) => isDue(row));
  const avgRating =
    crm.feedback.length > 0
      ? crm.feedback.reduce((sum, row) => sum + row.rating, 0) / crm.feedback.length
      : 0;
  // Escalations: overdue reminders + jobs still in progress past their date.
  const escalations =
    overdue.length +
    crm.jobs.filter((job) => job.status === "In Progress" && job.date < today).length;

  const completeReminder = async (row: FollowUpRow) => {
    setBusyId(row.id);
    try {
      await updateFollowUp(row.id, { status: "done" });
      toast.success("Team reminder closed");
      crm.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the reminder");
    } finally {
      setBusyId("");
    }
  };

  const snoozeReminder = async (row: FollowUpRow) => {
    setBusyId(row.id);
    try {
      const due = new Date(Date.now() + 86_400_000);
      due.setMinutes(0, 0, 0);
      await updateFollowUp(row.id, { dueAt: due.toISOString() });
      toast.success("Snoozed until tomorrow");
      crm.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not snooze the reminder");
    } finally {
      setBusyId("");
    }
  };

  const kpis: Array<[string, string, string]> = [
    ["Team revenue", money(teamRevenue), "closed jobs, all people"],
    [
      "Jobs today",
      String(teamJobsToday),
      `${crm.jobs.filter((job) => job.date === today && job.status !== "Completed").length} still open`,
    ],
    ["Follow-ups overdue", String(teamDue), teamDue ? "needs attention" : "team on schedule"],
    ["Escalations", String(escalations), escalations ? "review below" : "nothing blocked"],
    [
      "Team CSAT",
      avgRating > 0 ? `${avgRating.toFixed(1)} / 5` : "—",
      `${crm.feedback.length} ratings`,
    ],
  ];

  return (
    <>
      <KpiStrip label="Team summary" items={kpis} />

      <div className="dashboard-grid">
        <section className="panel jobs-panel">
          <div className="panel-head">
            <div>
              <h2>Team performance</h2>
              <p>{rows.length} people · jobs, revenue and follow-up load</p>
            </div>
            <UsersRound />
          </div>
          <div className="job-list">
            <div className="job-row" style={{ cursor: "default", background: "var(--muted)" }}>
              <div className="time">
                <strong>Person</strong>
                <span>role</span>
              </div>
              <div className="job-title">
                <strong>Workload</strong>
                <span>jobs today · revenue closed</span>
              </div>
              <span className="job-value">Follow-ups</span>
              <span className="job-value">Status</span>
              <span />
            </div>
            {rows.map((row) => (
              <div className="job-row" key={row.person.id} style={{ cursor: "default" }}>
                <div className="time">
                  <strong>{row.person.name.slice(0, 2).toUpperCase()}</strong>
                  <span>{row.person.role}</span>
                </div>
                <div className="job-title">
                  <strong>{row.person.name}</strong>
                  <span>
                    {row.jobsToday} jobs today · {money(row.revenue)} closed
                  </span>
                </div>
                <span className="job-value">{row.openFollowUps}</span>
                <span className={`status ${row.dueNow ? "status-due" : "status-completed"}`}>
                  <span />
                  {row.dueNow ? `${row.dueNow} overdue` : "clear"}
                </span>
                <TrendingUp
                  style={{ color: row.revenue > 0 ? "var(--primary)" : "var(--muted-foreground)" }}
                />
              </div>
            ))}
            {rows.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">No team members yet.</p>
            )}
          </div>
        </section>
        <aside className="right-stack">
          <section className="panel focus-panel">
            <div className="panel-head">
              <div>
                <h2>Escalations</h2>
                <p>{escalations ? `${escalations} items need attention` : "Nothing blocked"}</p>
              </div>
              <AlertTriangle />
            </div>
            {escalations === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Overdue reminders and stalled jobs surface here.
              </p>
            ) : (
              <>
                {overdue.slice(0, 3).map((row) => (
                  <div className="mini-job" key={row.id}>
                    <strong style={{ color: "var(--destructive, #b42318)" }}>!</strong>
                    <div>
                      <b>{row.notes || "Overdue reminder"}</b>
                      <span>{dueLabel(row.dueAt)}</span>
                    </div>
                  </div>
                ))}
                {crm.jobs
                  .filter((job) => job.status === "In Progress" && job.date < today)
                  .slice(0, 3)
                  .map((job) => (
                    <div className="mini-job" key={job.id}>
                      <strong style={{ color: "var(--destructive, #b42318)" }}>!</strong>
                      <div>
                        <b>{job.number} still in progress</b>
                        <span>dated {job.date}</span>
                      </div>
                    </div>
                  ))}
              </>
            )}
          </section>

          <section className="panel schedule-panel">
            <div className="panel-head">
              <div>
                <h2>Team follow-ups</h2>
                <p>{openFollowUps.length} open across the team</p>
              </div>
              <CalendarClock />
            </div>
            {openFollowUps.slice(0, 6).map((row) => {
              const late = isDue(row);
              const owner = crm.people.find((person) => person.id === row.ownerEmployeeId);
              return (
                <div className="mini-job" key={row.id} style={{ alignItems: "center" }}>
                  <strong style={{ color: late ? "var(--destructive, #b42318)" : undefined }}>
                    {dueLabel(row.dueAt).split(" · ")[0]}
                  </strong>
                  <div style={{ flex: 1 }}>
                    <b>{row.notes || "Follow-up"}</b>
                    <span>
                      {owner?.name ?? (row.ownerRole === "csr" ? "CSR queue" : "Sales queue")} ·{" "}
                      {dueLabel(row.dueAt)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === row.id}
                    onClick={() => void snoozeReminder(row)}
                  >
                    +1d
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === row.id}
                    onClick={() => void completeReminder(row)}
                  >
                    Done
                  </Button>
                </div>
              );
            })}
            {openFollowUps.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">Team queue is clear.</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
