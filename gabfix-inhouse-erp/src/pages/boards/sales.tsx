import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Modal } from "@/components/Modal";
import {
  LEAD_STAGES,
  OPEN_STAGES,
  createLead,
  dueLabel,
  isDue,
  isDueToday,
  updateFollowUp,
  updateLead,
  useCrmData,
  type Lead,
  type LeadStage,
} from "@/lib/crm";
import { addDays, kampalaDayKey, weekDays } from "@/lib/timesheet";
import { KpiStrip, money } from "./shared";
import { InteractionModal, ScheduleFollowUpModal } from "./crm-modals";

/**
 * Sales panes: "My day" (performance graph + queue + reminders + workflow)
 * plus the shared LeadModal used by the New task button. Figures are scoped
 * to the signed-in employee's own customers/leads — each sales person sees
 * their own list (falling back to the shared list only when nothing is
 * attributed yet, so a fresh workspace still demos honestly).
 */

const CLOSED_STATUSES = new Set(["Completed", "Invoiced", "Paid"]);

const weekdayShort = (dayKey: string): string =>
  new Date(`${dayKey}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    timeZone: "UTC",
  });

function useScoped(salespersonId: string) {
  const crm = useCrmData();
  const mine = useMemo(
    () => crm.leads.filter((lead) => lead.salespersonId === salespersonId),
    [crm.leads, salespersonId],
  );
  const myCustomers = useMemo(
    () => crm.customers.filter((customer) => customer.salespersonId === salespersonId),
    [crm.customers, salespersonId],
  );
  const myFollowUps = useMemo(
    () =>
      crm.followUps.filter(
        (row) =>
          row.ownerRole === "sales" &&
          (row.ownerEmployeeId === salespersonId || row.ownerEmployeeId === null),
      ),
    [crm.followUps, salespersonId],
  );
  return {
    crm,
    leads: mine.length ? mine : crm.leads,
    customers: myCustomers.length ? myCustomers : crm.customers,
    followUps: myFollowUps,
  };
}

/** New client entry — workflow step 0 (also opened by the New task button). */
export function LeadModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState("");
  const [stage, setStage] = useState<LeadStage>("Lead");
  const [followDate, setFollowDate] = useState("");
  const [followTime, setFollowTime] = useState("09:00");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setFailure("Give the client a name.");
      return;
    }
    let nextFollowUpAt: string | undefined;
    if (followDate && followTime) {
      const parsed = new Date(`${followDate}T${followTime}`);
      if (!Number.isNaN(parsed.getTime())) nextFollowUpAt = parsed.toISOString();
    }
    setSaving(true);
    setFailure("");
    try {
      await createLead({
        name: name.trim(),
        contact: contact.trim(),
        company: company.trim(),
        phone: phone.trim(),
        stage,
        value: Number(value) || 0,
        source: "portal",
        nextFollowUpAt,
      });
      toast.success("Client added to your workflow");
      setName("");
      setContact("");
      setCompany("");
      setPhone("");
      setValue("");
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not add the client");
    } finally {
      setSaving(false);
    }
  };
  if (!open) return null;
  return (
    <Modal
      open
      title="New client"
      description="Enter a client into your workflow"
      onClose={onClose}
      size="lg"
    >
      <form onSubmit={submit} className="modal-form">
        <Field label="Client name">
          <input
            className="field"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sarah Nanyonga"
          />
        </Field>
        <div className="field-row">
          <Field label="Contact person">
            <input className="field" value={contact} onChange={(e) => setContact(e.target.value)} />
          </Field>
          <Field label="Company">
            <input className="field" value={company} onChange={(e) => setCompany(e.target.value)} />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Phone">
            <input
              className="field"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+256…"
            />
          </Field>
          <Field label="Estimated value (UGX)">
            <input
              className="field"
              type="number"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        </div>
        <div className="field-row">
          <Field label="Stage">
            <select
              className="field"
              value={stage}
              onChange={(e) => setStage(e.target.value as LeadStage)}
            >
              {LEAD_STAGES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="First follow-up date" hint="Optional — the day you'll be reminded">
            <input
              className="field"
              type="date"
              value={followDate}
              onChange={(e) => setFollowDate(e.target.value)}
            />
          </Field>
        </div>
        <Field label="First follow-up time" hint="Optional — the time you'll be reminded">
          <input
            className="field"
            type="time"
            value={followTime}
            onChange={(e) => setFollowTime(e.target.value)}
          />
        </Field>
        {failure ? <p className="ts-error">{failure}</p> : null}
        <div className="modal-foot">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Adding…" : "Add to workflow"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── My day: performance graph + queue + reminders ───────────────────────── */

export function SalesDay({ salespersonId }: { salespersonId: string | null }) {
  const { crm, leads, followUps, customers } = useScoped(salespersonId ?? "");
  const [weekOffset, setWeekOffset] = useState(0);
  const [leadOpen, setLeadOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState<Lead | null>(null);
  const [logFor, setLogFor] = useState<Lead | null>(null);
  const [busyId, setBusyId] = useState("");

  const today = kampalaDayKey(new Date());
  const anchor = addDays(today, weekOffset * 7);
  const days = weekDays(anchor);

  const openLeads = leads.filter((lead) => OPEN_STAGES.includes(lead.stage));
  const wonLeads = leads.filter((lead) => lead.stage === "Won");
  const myCustomerIds = new Set(customers.map((customer) => customer.id));
  const myJobs = crm.jobs.filter((job) => job.customerId && myCustomerIds.has(job.customerId));
  const weekJobs = myJobs.filter(
    (job) => days.includes(job.date) && CLOSED_STATUSES.has(job.status),
  );
  const weekRevenue = weekJobs.reduce((sum, job) => sum + (job.revenue ?? 0), 0);
  const pending = followUps.filter((row) => row.status === "pending");
  const dueToday = pending.filter((row) => isDueToday(row));
  const dueNow = pending.filter((row) => isDue(row));
  const maxDay = Math.max(
    1,
    ...days.map((day) =>
      weekJobs.filter((job) => job.date === day).reduce((sum, job) => sum + (job.revenue ?? 0), 0),
    ),
  );

  const complete = async (id: string) => {
    setBusyId(id);
    try {
      await updateFollowUp(id, { status: "done" });
      toast.success("Follow-up marked done");
      crm.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the follow-up");
    } finally {
      setBusyId("");
    }
  };

  const advance = async (lead: Lead) => {
    const index = LEAD_STAGES.indexOf(lead.stage);
    const next = LEAD_STAGES[Math.min(index + 1, LEAD_STAGES.indexOf("Won"))] ?? "Won";
    if (next === lead.stage) return;
    setBusyId(lead.id);
    try {
      await updateLead(lead.id, { stage: next });
      toast.success(`${lead.name} moved to ${next}`);
      crm.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move the lead");
    } finally {
      setBusyId("");
    }
  };

  const kpis: Array<[string, string, string]> = [
    [
      "Open pipeline",
      money(openLeads.reduce((sum, lead) => sum + (lead.value ?? 0), 0)),
      `${openLeads.length} in the queue`,
    ],
    ["Clients brought in", String(customers.length), `${wonLeads.length} won from my leads`],
    [
      "Revenue this week",
      money(weekRevenue),
      weekOffset === 0 ? "Mon → Sun, current week" : "selected week",
    ],
    [
      "Follow-ups due",
      String(dueToday.length),
      dueNow.length ? `${dueNow.length} overdue now` : "on schedule",
    ],
  ];

  return (
    <>
      <KpiStrip label="Sales summary" items={kpis} />

      <div className="dashboard-grid">
        <section className="panel jobs-panel">
          <div className="panel-head">
            <div>
              <h2>My performance</h2>
              <p>Closed revenue per day · attributed to my clients</p>
            </div>
            <div className="week-nav">
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous week"
                onClick={() => setWeekOffset((w) => w - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Next week"
                onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
          <div className="week-strip" style={{ padding: "0 4px" }}>
            {days.map((day) => {
              const revenue = weekJobs
                .filter((job) => job.date === day)
                .reduce((sum, job) => sum + (job.revenue ?? 0), 0);
              const height = Math.round((revenue / maxDay) * 100);
              return (
                <div key={day} className={`week-day ${day === today ? "week-day-today" : ""}`}>
                  <span>{weekdayShort(day)}</span>
                  <div className="week-bar">
                    <i style={{ height: `${Math.max(revenue > 0 ? 6 : 2, height)}%` }} />
                  </div>
                  <strong>{revenue > 0 ? `${Math.round(revenue / 1000)}K` : "—"}</strong>
                </div>
              );
            })}
          </div>

          <div className="panel-head" style={{ marginTop: 8 }}>
            <div>
              <h2>Client workflow</h2>
              <p>{openLeads.length} in queue · stage by stage</p>
            </div>
            <Button size="sm" onClick={() => setLeadOpen(true)}>
              <Plus /> New client
            </Button>
          </div>
          <div className="job-list">
            {leads.map((lead) => {
              const due = lead.nextFollowUpAt ? dueLabel(lead.nextFollowUpAt) : "No follow-up set";
              const overdue =
                lead.nextFollowUpAt !== null && Date.parse(lead.nextFollowUpAt) <= Date.now();
              const canAdvance = lead.stage !== "Won" && lead.stage !== "Lost";
              return (
                <div className="job-row" key={lead.id} style={{ cursor: "default" }}>
                  <div className="time">
                    <strong>{lead.value > 0 ? `${Math.round(lead.value / 1000)}K` : "—"}</strong>
                    <span>{lead.source}</span>
                  </div>
                  <div className="job-title">
                    <strong>{lead.name}</strong>
                    <span>
                      {lead.company || lead.contact || lead.phone || "Lead"} · {lead.stage}
                    </span>
                  </div>
                  <span className={`status ${overdue ? "status-due" : "status-scheduled"}`}>
                    <span />
                    {due}
                  </span>
                  <span className="job-value">{lead.stage}</span>
                  <div
                    style={{ display: "flex", gap: 6 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button size="sm" variant="ghost" onClick={() => setLogFor(lead)}>
                      Log
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setScheduleFor(lead)}>
                      Follow up
                    </Button>
                    {canAdvance ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === lead.id}
                        onClick={() => void advance(lead)}
                      >
                        Advance
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {leads.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No clients in your workflow yet — add your first with “New client”.
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
              const subject =
                leads.find((lead) => lead.id === row.leadId)?.name ??
                customers.find((customer) => customer.id === row.customerId)?.name ??
                row.notes;
              const late = isDue(row);
              return (
                <div className="mini-job" key={row.id} style={{ alignItems: "center" }}>
                  <strong style={{ color: late ? "var(--destructive, #b42318)" : undefined }}>
                    {dueLabel(row.dueAt).split(" · ")[0]}
                  </strong>
                  <div style={{ flex: 1 }}>
                    <b>{subject || "Follow-up"}</b>
                    <span>{dueLabel(row.dueAt)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === row.id}
                    onClick={() => void complete(row.id)}
                  >
                    Done
                  </Button>
                </div>
              );
            })}
            {pending.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Nothing pending — schedule one from a client row.
              </p>
            )}
          </section>

          <section className="panel schedule-panel">
            <div className="panel-head">
              <div>
                <h2>Clients I brought in</h2>
                <p>{customers.length} attributed to you</p>
              </div>
              <Users />
            </div>
            {customers.slice(0, 5).map((customer) => (
              <div className="mini-job" key={customer.id}>
                <strong>{customer.name.slice(0, 2).toUpperCase()}</strong>
                <div>
                  <b>{customer.name}</b>
                  <span>
                    {customer.lastContactedAt
                      ? `Last contact ${kampalaDayKey(customer.lastContactedAt)}`
                      : "No contact logged yet"}
                  </span>
                </div>
              </div>
            ))}
            {customers.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Won leads convert into customers attributed to you.
              </p>
            )}
          </section>
        </aside>
      </div>

      <LeadModal open={leadOpen} onClose={() => setLeadOpen(false)} onSaved={crm.refresh} />
      <ScheduleFollowUpModal
        open={Boolean(scheduleFor)}
        defaults={{ leadId: scheduleFor?.id, subject: scheduleFor?.name }}
        onClose={() => setScheduleFor(null)}
        onSaved={crm.refresh}
      />
      <InteractionModal
        open={Boolean(logFor)}
        defaults={{ leadId: logFor?.id, subject: logFor?.name }}
        onClose={() => setLogFor(null)}
        onSaved={crm.refresh}
      />
    </>
  );
}

/* ── "My clients" board: the full list a sales person owns ───────────────── */

export function SalesClients({ salespersonId }: { salespersonId: string | null }) {
  const { crm, leads, customers } = useScoped(salespersonId ?? "");
  const [leadOpen, setLeadOpen] = useState(false);

  return (
    <>
      <div className="dashboard-grid">
        <section className="panel jobs-panel">
          <div className="panel-head">
            <div>
              <h2>My workflow</h2>
              <p>
                {leads.length} clients entered ·{" "}
                {leads.filter((lead) => OPEN_STAGES.includes(lead.stage)).length} still open
              </p>
            </div>
            <Button size="sm" onClick={() => setLeadOpen(true)}>
              <Plus /> New client
            </Button>
          </div>
          <div className="job-list">
            {leads.map((lead) => (
              <div className="job-row" key={lead.id} style={{ cursor: "default" }}>
                <div className="time">
                  <strong>{lead.value > 0 ? `${Math.round(lead.value / 1000)}K` : "—"}</strong>
                  <span>{lead.source}</span>
                </div>
                <div className="job-title">
                  <strong>{lead.name}</strong>
                  <span>
                    {lead.company || lead.contact || lead.phone || "Lead"} · entered{" "}
                    {lead.createdAt.slice(0, 10)}
                  </span>
                </div>
                <span
                  className={`status ${
                    lead.stage === "Won"
                      ? "status-started"
                      : lead.stage === "Lost"
                        ? "status-completed"
                        : "status-scheduled"
                  }`}
                >
                  <span />
                  {lead.stage}
                </span>
                <span className="job-value">
                  {lead.nextFollowUpAt
                    ? `Follow-up ${lead.nextFollowUpAt.slice(0, 10)}`
                    : "No follow-up"}
                </span>
                <ChevronRight />
              </div>
            ))}
            {leads.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nothing entered yet — “New client” starts the workflow.
              </p>
            )}
          </div>
        </section>

        <aside className="right-stack">
          <section className="panel schedule-panel">
            <div className="panel-head">
              <div>
                <h2>Customers attributed to me</h2>
                <p>{customers.length} clients brought into the company</p>
              </div>
              <Users />
            </div>
            {customers.map((customer) => {
              const revenue = crm.jobs
                .filter((job) => job.customerId === customer.id && CLOSED_STATUSES.has(job.status))
                .reduce((sum, job) => sum + (job.revenue ?? 0), 0);
              return (
                <div className="mini-job" key={customer.id}>
                  <strong>{customer.name.slice(0, 2).toUpperCase()}</strong>
                  <div>
                    <b>{customer.name}</b>
                    <span>
                      {money(revenue)} revenue ·{" "}
                      {customer.lastContactedAt
                        ? `contacted ${customer.lastContactedAt.slice(0, 10)}`
                        : "no contact logged"}
                    </span>
                  </div>
                </div>
              );
            })}
            {customers.length === 0 && (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Won leads convert into customers attributed to you.
              </p>
            )}
          </section>
        </aside>
      </div>

      <LeadModal open={leadOpen} onClose={() => setLeadOpen(false)} onSaved={crm.refresh} />
    </>
  );
}

/* ── "Follow-ups" board: the full reminder queue ─────────────────────────── */

export function SalesFollowUps({ salespersonId }: { salespersonId: string | null }) {
  const { crm, leads, customers, followUps } = useScoped(salespersonId ?? "");
  const [busyId, setBusyId] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const pending = followUps.filter((row) => row.status !== "done");

  const act = async (id: string, status: "done" | "skipped") => {
    setBusyId(id);
    try {
      await updateFollowUp(id, { status });
      toast.success(status === "done" ? "Follow-up completed" : "Follow-up skipped");
      crm.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the follow-up");
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <div className="dashboard-grid">
        <section className="panel jobs-panel">
          <div className="panel-head">
            <div>
              <h2>Follow-up queue</h2>
              <p>
                {pending.filter((row) => isDue(row)).length} overdue · {pending.length} open
              </p>
            </div>
            <Button size="sm" onClick={() => setScheduleOpen(true)}>
              <Plus /> Schedule
            </Button>
          </div>
          <div className="job-list">
            {pending.map((row) => {
              const subject =
                leads.find((lead) => lead.id === row.leadId)?.name ??
                customers.find((customer) => customer.id === row.customerId)?.name ??
                row.notes;
              const late = isDue(row);
              return (
                <div className="job-row" key={row.id} style={{ cursor: "default" }}>
                  <div className="time">
                    <strong>{dueLabel(row.dueAt).split(" · ")[0]}</strong>
                    <span>{dueLabel(row.dueAt).split(" · ")[1] ?? ""}</span>
                  </div>
                  <div className="job-title">
                    <strong>{subject || "Follow-up"}</strong>
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
                  <span className="job-value">
                    {row.type === "feedback_outreach" ? "Feedback" : "Client"}
                  </span>
                  <div
                    style={{ display: "flex", gap: 6 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "done")}
                    >
                      Done
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "skipped")}
                    >
                      Skip
                    </Button>
                  </div>
                </div>
              );
            })}
            {pending.length === 0 && (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Queue clear — schedule one to get started.
              </p>
            )}
          </div>
        </section>
      </div>
      <ScheduleFollowUpModal
        open={scheduleOpen}
        defaults={{}}
        onClose={() => setScheduleOpen(false)}
        onSaved={crm.refresh}
      />
    </>
  );
}
