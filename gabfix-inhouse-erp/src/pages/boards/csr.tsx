import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, MessageSquareHeart, PhoneCall, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  dueLabel,
  isDue,
  isDueToday,
  updateFollowUp,
  useCrmData,
  type FollowUpRow,
} from "@/lib/crm";
import { kampalaDayKey } from "@/lib/timesheet";
import { KpiStrip } from "./shared";
import { InteractionModal, ScheduleFollowUpModal } from "./crm-modals";

/**
 * CSR panes: "My day" (feedback-outreach cadence + job-start engagement +
 * follow-up reminders + latest feedback) and "Follow-ups" (the full queue).
 * The cadence is server-owned: completing an outreach without feedback
 * re-queues the next attempt in follow_up_after_days (the 2-day rule), and a
 * completed job without feedback seeds its own outreach row.
 */

const DAY_MS = 86_400_000;

/** Outreach rows a CSR works: the shared csr queue + rows they own. */
function useCsrQueue(employeeId: string | null) {
  const crm = useCrmData();
  const queue = useMemo(
    () =>
      crm.followUps.filter(
        (row) =>
          row.ownerRole === "csr" &&
          (row.ownerEmployeeId === employeeId || row.ownerEmployeeId === null),
      ),
    [crm.followUps, employeeId],
  );
  return { crm, queue };
}

/** Completed jobs that still have no feedback recorded. */
function outstandingFeedback(
  jobs: Array<{ id: string; number: string; customerId: string | null; status: string }>,
  feedbackJobIds: Set<string>,
) {
  return jobs.filter(
    (job) =>
      (job.status === "Completed" || job.status === "Invoiced" || job.status === "Paid") &&
      job.customerId &&
      !feedbackJobIds.has(job.id),
  );
}

/* ── My day ─────────────────────────────────────────────────────────────── */

export function CsrDay({ employeeId }: { employeeId: string | null }) {
  const { crm, queue } = useCsrQueue(employeeId);
  const [busyId, setBusyId] = useState("");
  const [logFor, setLogFor] = useState<{
    id: string;
    subject: string;
    customerId?: string | undefined;
    jobId?: string | undefined;
  } | null>(null);
  const [scheduleSubject, setScheduleSubject] = useState("");

  const pending = queue.filter((row) => row.status === "pending");
  const dueNow = pending.filter((row) => isDue(row));
  const dueToday = pending.filter((row) => isDueToday(row));
  const outreach = pending.filter((row) => row.type === "feedback_outreach");

  const feedbackJobIds = new Set(crm.feedback.map((row) => row.jobId).filter(Boolean) as string[]);
  const awaiting = outstandingFeedback(crm.jobs, feedbackJobIds);
  const started = crm.jobs.filter((job) => job.status === "In Progress");
  const avgRating =
    crm.feedback.length > 0
      ? crm.feedback.reduce((sum, row) => sum + row.rating, 0) / crm.feedback.length
      : 0;
  const weekInteractions = crm.interactions.filter(
    (row) => Date.now() - Date.parse(row.createdAt) < 7 * DAY_MS,
  );

  const customerName = (id: string | null) =>
    crm.customers.find((customer) => customer.id === id)?.name ?? "Client";

  const completeOutreach = async (row: FollowUpRow, requeue: boolean) => {
    setBusyId(row.id);
    try {
      await updateFollowUp(row.id, {
        status: "done",
        // Attempted but no feedback yet → next attempt in the 2-day cadence.
        requeueDays: requeue ? row.followUpAfterDays : 0,
      });
      toast.success(requeue ? "Logged — we'll remind you again in 2 days" : "Outreach closed");
      crm.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the outreach");
    } finally {
      setBusyId("");
    }
  };

  const kpis: Array<[string, string, string]> = [
    ["Feedback outreach due", String(outreach.length), `${dueNow.length} reminders due now`],
    ["Awaiting feedback", String(awaiting.length), "jobs completed, no rating yet"],
    [
      "Client check-ins due",
      String(dueToday.length - outreach.filter((row) => isDueToday(row)).length),
      "job-start + service touches",
    ],
    [
      "Average rating",
      avgRating > 0 ? `${avgRating.toFixed(1)} / 5` : "—",
      `${crm.feedback.length} ratings recorded`,
    ],
    ["Contacts this week", String(weekInteractions.length), "logged in the interaction log"],
  ];

  return (
    <>
      <KpiStrip label="Customer support summary" items={kpis} />

      <div className="dashboard-grid">
        <section className="panel jobs-panel">
          <div className="panel-head">
            <div>
              <h2>Feedback outreach</h2>
              <p>
                {awaiting.length} completed jobs awaiting feedback · re-check every 2 days until an
                answer lands
              </p>
            </div>
            <MessageSquareHeart />
          </div>
          <div className="job-list">
            {outreach.slice(0, 8).map((row) => {
              const late = isDue(row);
              const job = crm.jobs.find((item) => item.id === row.jobId);
              return (
                <div className="job-row" key={row.id} style={{ cursor: "default" }}>
                  <div className="time">
                    <strong>{kampalaDayKey(row.dueAt).slice(5)}</strong>
                    <span>{job?.number ?? "job"}</span>
                  </div>
                  <div className="job-title">
                    <strong>{customerName(row.customerId)}</strong>
                    <span>{row.notes || "Feedback check-in"}</span>
                  </div>
                  <span className={`status ${late ? "status-due" : "status-scheduled"}`}>
                    <span />
                    {dueLabel(row.dueAt)}
                  </span>
                  <span className="job-value">{row.followUpAfterDays}d cadence</span>
                  <div
                    style={{ display: "flex", gap: 6 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setLogFor({
                          id: row.id,
                          subject: customerName(row.customerId),
                          customerId: row.customerId ?? undefined,
                          jobId: row.jobId ?? undefined,
                        })
                      }
                    >
                      Log call
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id}
                      onClick={() => void completeOutreach(row, true)}
                    >
                      Contacted
                    </Button>
                  </div>
                </div>
              );
            })}
            {outreach.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No outreach due — new rows appear automatically when jobs complete without feedback.
              </p>
            )}
          </div>

          <div className="panel-head" style={{ marginTop: 8 }}>
            <div>
              <h2>Job-start engagement</h2>
              <p>{started.length} jobs in progress · confirm the client is happy on site</p>
            </div>
            <PhoneCall />
          </div>
          <div className="job-list">
            {started.slice(0, 5).map((job) => (
              <div className="job-row" key={job.id} style={{ cursor: "default" }}>
                <div className="time">
                  <strong>{job.date.slice(5)}</strong>
                  <span>{job.number}</span>
                </div>
                <div className="job-title">
                  <strong>{customerName(job.customerId)}</strong>
                  <span>Job started · pre-completion check-in</span>
                </div>
                <span className="status status-started">
                  <span />
                  In Progress
                </span>
                <span className="job-value">
                  {job.revenue > 0 ? `${Math.round(job.revenue / 1000)}K` : "—"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLogFor({
                      id: job.id,
                      subject: customerName(job.customerId),
                      customerId: job.customerId ?? undefined,
                      jobId: job.id,
                    })
                  }
                >
                  Log contact
                </Button>
              </div>
            ))}
            {started.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                No jobs in progress right now.
              </p>
            )}
          </div>
        </section>
        <aside className="right-stack">
          <section className="panel focus-panel">
            <div className="panel-head">
              <div>
                <h2>Follow-up reminders</h2>
                <p>{dueNow.length ? `${dueNow.length} due now` : `${dueToday.length} due today`}</p>
              </div>
              <CalendarClock />
            </div>
            {pending.slice(0, 6).map((row) => {
              const late = isDue(row);
              return (
                <div className="mini-job" key={row.id} style={{ alignItems: "center" }}>
                  <strong style={{ color: late ? "var(--destructive, #b42318)" : undefined }}>
                    {dueLabel(row.dueAt).split(" · ")[0]}
                  </strong>
                  <div style={{ flex: 1 }}>
                    <b>{customerName(row.customerId) || row.notes || "Follow-up"}</b>
                    <span>{dueLabel(row.dueAt)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === row.id}
                    onClick={() => void completeOutreach(row, row.type === "feedback_outreach")}
                  >
                    Done
                  </Button>
                </div>
              );
            })}
            {pending.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">Queue clear — nothing due.</p>
            )}
          </section>

          <section className="panel schedule-panel">
            <div className="panel-head">
              <div>
                <h2>Latest feedback</h2>
                <p>{crm.feedback.length} ratings recorded</p>
              </div>
              <Star />
            </div>
            {crm.feedback.slice(0, 5).map((row) => (
              <div className="mini-job" key={row.id}>
                <strong>{"★".repeat(row.rating)}</strong>
                <div>
                  <b>{customerName(row.customerId)}</b>
                  <span>{row.comment || `Rated ${row.rating} of 5`}</span>
                </div>
              </div>
            ))}
            {crm.feedback.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                No ratings yet — outreach turns job feedback into this list.
              </p>
            )}
          </section>
        </aside>
      </div>

      <InteractionModal
        open={Boolean(logFor)}
        defaults={{
          customerId: logFor?.customerId,
          jobId: logFor?.jobId,
          subject: logFor?.subject,
        }}
        onClose={() => setLogFor(null)}
        onSaved={crm.refresh}
      />
      {scheduleSubject ? (
        <ScheduleFollowUpModal
          open
          defaults={{ subject: scheduleSubject }}
          onClose={() => setScheduleSubject("")}
          onSaved={crm.refresh}
        />
      ) : null}
    </>
  );
}

/* ── "Follow-ups" board: the full CSR reminder queue ─────────────────────── */

export function CsrFollowUps({ employeeId }: { employeeId: string | null }) {
  const { crm, queue } = useCsrQueue(employeeId);
  const [busyId, setBusyId] = useState("");
  const [logFor, setLogFor] = useState<{
    subject: string;
    customerId?: string | undefined;
    jobId?: string | undefined;
  } | null>(null);
  const pending = queue.filter((row) => row.status !== "done");

  const act = async (row: FollowUpRow, status: "done" | "skipped") => {
    setBusyId(row.id);
    try {
      await updateFollowUp(row.id, {
        status,
        // Feedback outreach that was attempted but got no answer comes back
        // in the 2-day cadence; skipped rows stay closed.
        requeueDays:
          status === "done" && row.type === "feedback_outreach" ? row.followUpAfterDays : 0,
      });
      toast.success(status === "done" ? "Follow-up completed" : "Follow-up skipped");
      crm.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the follow-up");
    } finally {
      setBusyId("");
    }
  };

  const customerName = (id: string | null) =>
    crm.customers.find((customer) => customer.id === id)?.name ?? "Client";

  return (
    <>
      <div className="dashboard-grid">
        <section className="panel jobs-panel">
          <div className="panel-head">
            <div>
              <h2>CSR follow-up queue</h2>
              <p>
                {pending.filter((row) => isDue(row)).length} overdue · {pending.length} open ·
                feedback outreach re-queues every 2 days
              </p>
            </div>
            <CalendarClock />
          </div>
          <div className="job-list">
            {pending.map((row) => {
              const late = isDue(row);
              const job = crm.jobs.find((item) => item.id === row.jobId);
              return (
                <div className="job-row" key={row.id} style={{ cursor: "default" }}>
                  <div className="time">
                    <strong>{kampalaDayKey(row.dueAt).slice(5)}</strong>
                    <span>
                      {(job?.number ?? row.type === "feedback_outreach") ? "feedback" : "client"}
                    </span>
                  </div>
                  <div className="job-title">
                    <strong>{customerName(row.customerId)}</strong>
                    <span>
                      {row.notes ||
                        (row.type === "feedback_outreach"
                          ? "Feedback check-in"
                          : "Client follow-up")}
                    </span>
                  </div>
                  <span className={`status ${late ? "status-due" : "status-scheduled"}`}>
                    <span />
                    {dueLabel(row.dueAt)}
                  </span>
                  <span className="job-value">{row.followUpAfterDays}d cadence</span>
                  <div
                    style={{ display: "flex", gap: 6 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setLogFor({
                          subject: customerName(row.customerId),
                          customerId: row.customerId ?? undefined,
                          jobId: row.jobId ?? undefined,
                        })
                      }
                    >
                      Log call
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id}
                      onClick={() => void act(row, "done")}
                    >
                      Done
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === row.id}
                      onClick={() => void act(row, "skipped")}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              );
            })}
            {pending.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Queue clear — outreach rows appear when jobs complete without feedback.
              </p>
            )}
          </div>
        </section>
      </div>

      <InteractionModal
        open={Boolean(logFor)}
        defaults={{
          customerId: logFor?.customerId,
          jobId: logFor?.jobId,
          subject: logFor?.subject,
        }}
        onClose={() => setLogFor(null)}
        onSaved={crm.refresh}
      />
    </>
  );
}
