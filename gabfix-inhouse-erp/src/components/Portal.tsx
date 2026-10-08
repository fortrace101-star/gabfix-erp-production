import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
  X,
  ArrowUpRight,
  AlertCircle,
  Download,
  Play,
  Pause,
  CircleDollarSign,
  MessageSquare,
  Target,
  Filter,
  Eye,
  EyeOff,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { portalApi, type EmployeeSession } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useEmployeeWorkspace, setJobStatus, type PortalJob } from "@/lib/workspace";
import { PortalBell } from "@/components/PortalBell";
import { JobChecklistPanel } from "@/components/JobChecklistPanel";
import { ConcernsInbox } from "@/components/ConcernsInbox";
import { ConcernForm } from "@/components/ConcernForm";
import { checklistGate } from "@/lib/gating";
import { LeadModal, ProposeOrderModal } from "@/pages/boards/sales";
import { InteractionModal, ScheduleFollowUpModal } from "@/pages/boards/crm-modals";
import { LEAD_STAGES, updateFollowUp, updateLead } from "@/lib/crm";
import { absoluteShareUrl, shareProposal } from "@/lib/orders";
import { toast as sonner } from "sonner";

const LOGO_SRC = "/gabfix-logo.png";

type Role = "Technician" | "Sales" | "Supervisor" | "Support";
type JobStatus = "Scheduled" | "In progress" | "Completed";
type Job = {
  id: string;
  dbId: string;
  title: string;
  customer: string;
  place: string;
  time: string;
  status: JobStatus;
  revenue: number;
};
const navigation: Record<Role, { label: string; icon: typeof LayoutDashboard }[]> = {
  Technician: [
    { label: "Overview", icon: LayoutDashboard },
    { label: "My jobs", icon: BriefcaseBusiness },
    { label: "Schedule", icon: CalendarDays },
  ],
  Sales: [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Leads", icon: Target },
    { label: "Proposals", icon: FileText },
    { label: "Follow-ups", icon: ClipboardCheck },
  ],
  Supervisor: [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Team", icon: Users },
    { label: "Leads", icon: Target },
    { label: "Concerns", icon: AlertCircle },
  ],
  Support: [
    { label: "Overview", icon: LayoutDashboard },
    { label: "Leads", icon: Target },
    { label: "Follow-ups", icon: ClipboardCheck },
    { label: "Feedback", icon: MessageSquare },
  ],
};
/**
 * Server role → the portal pane that employee sees. Total on purpose: every
 * account the server can mint lands in a real pane, so the layout is always a
 * function of the signed-in employee's role (no role picker to override it).
 * Back-office roles (owner / manager / accountant / storekeeper / laundry) have
 * no dedicated crew pane, so they get the Supervisor view.
 */
const toPortalRole = (serverRole: string): Role => {
  const value = serverRole.trim().toLowerCase();
  if (value === "technician") return "Technician";
  if (value === "sales") return "Sales";
  if (value === "csr" || value === "support") return "Support";
  return "Supervisor";
};
/** Human label for the employee's server role, shown in the profile + Settings. */
const ROLE_TITLES: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  supervisor: "Supervisor",
  sales: "Sales",
  technician: "Technician",
  accountant: "Accountant",
  storekeeper: "Storekeeper",
  laundry: "Laundry",
  csr: "Customer Support",
};
const roleTitle = (serverRole: string): string => {
  const value = serverRole.trim().toLowerCase();
  return ROLE_TITLES[value] ?? serverRole;
};
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** DB job day (YYYY-MM-DD) → compact list label ("5 Oct"). */
const formatJobDay = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[3])} ${MONTH_SHORT[Number(match[2]) - 1] ?? ""}`;
};
/** Server job status → the list's three-state badge. */
const toListStatus = (status: string): JobStatus => {
  const value = status.toLowerCase();
  if (value === "in progress" || value === "started") return "In progress";
  if (value === "completed" || value === "invoiced" || value === "paid") return "Completed";
  return "Scheduled";
};
/** A job assigned to this employee (GET /api/data) → the list's row shape. */
const fromLiveJob = (job: PortalJob): Job => ({
  id: job.number || job.id,
  dbId: job.id,
  title: job.service,
  customer: job.customer,
  place: job.place,
  time: formatJobDay(job.date),
  status: toListStatus(job.status),
  revenue: job.revenue,
});
const today = new Date();
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const kampalaToday = new Date(today.getTime() + 3 * 60 * 60 * 1000);
const dateLabel = `${weekdays[kampalaToday.getUTCDay()]}, ${kampalaToday.getUTCDate()} ${months[kampalaToday.getUTCMonth()]} ${kampalaToday.getUTCFullYear()}`;

export default function Portal() {
  const [active, setActive] = useState("Overview");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [profile, setProfile] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("All");
  const [week, setWeek] = useState(0);
  const [passwordShown, setPasswordShown] = useState(false);
  const [inputName, setInputName] = useState("");
  const [inputPassword, setInputPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  // ── Signed-in identity (plan A6): resolve the employee from GET /auth/me and
  // derive everything below from them — the pane/nav/metrics come from their
  // server role, the job feed from their own job_assignments rows. All hooks
  // stay above the gate so SSR and the hydrated client run the same hook order.
  const { session: liveSession, loading: sessionLoading } = useSession();
  const [session, setSession] = useState<EmployeeSession | null>(null);
  useEffect(() => {
    if (liveSession) setSession(liveSession);
  }, [liveSession]);
  const role = toPortalRole(session?.role ?? "");
  const {
    feed,
    error: feedError,
    reload,
  } = useEmployeeWorkspace(session ? { id: session.id, role: session.role } : null);
  const leads = feed?.leads ?? [];
  const followUps = feed?.followUps ?? [];
  const feedback = feed?.feedback ?? [];
  const crew = feed?.crew ?? [];
  // Order lifecycle (plan P1): orders still sitting in `Proposed` — awaiting a
  // manager's phone-verified confirmation — plus the catalogue the proposal
  // form picks from (both come from the same GET /api/data read).
  const proposals = useMemo(
    () => (feed?.jobs ?? []).filter((job) => job.status === "Proposed"),
    [feed],
  );
  const customers = feed?.customers ?? [];
  const services = feed?.services ?? [];
  // Only ever what this employee is actually associated with — no demo rows.
  useEffect(() => {
    setJobs((feed?.myJobs ?? []).map(fromLiveJob));
  }, [feed]);
  const displayName = session?.name?.trim() ?? "";
  const displayFirst = displayName.split(/\s+/)[0] ?? displayName;
  const initials = displayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const submitSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      const user = await portalApi.auth.login(inputName.trim(), inputPassword);
      if (!user.app_scope.includes("portal")) {
        setLoginError(
          "This account doesn't have Portal access. Ask your Admin for an invite code that includes the Portal app.",
        );
        return;
      }
      setInputPassword("");
      setSession(user);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Sign in failed. Try again.");
    } finally {
      setLoginBusy(false);
    }
  };
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  };
  const [checklistReady, setChecklistReady] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [raiseConcernOpen, setRaiseConcernOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [scheduleLeadId, setScheduleLeadId] = useState<{ id: string; name: string } | null>(null);
  const [logLeadId, setLogLeadId] = useState<{ id: string; name: string } | null>(null);
  const [crmBusy, setCrmBusy] = useState("");
  // Sales actions (plan S1–S3): Add Lead opens LeadModal; per-row Follow-up /
  // Log open the shared CRM modals; advance moves the lead one pipeline stage.
  // Every write reloads the employee feed so the lists reflect live state.
  const advanceLead = async (id: string, stage: string) => {
    const index = LEAD_STAGES.indexOf(stage as (typeof LEAD_STAGES)[number]);
    const next = LEAD_STAGES[Math.min(index + 1, LEAD_STAGES.indexOf("Won"))] ?? "Won";
    if (index < 0 || next === stage) return;
    setCrmBusy(id);
    try {
      await updateLead(id, { stage: next });
      sonner.success(`Moved to ${next}`);
      reload();
    } catch (err) {
      sonner.error(err instanceof Error ? err.message : "Could not move the lead");
    } finally {
      setCrmBusy("");
    }
  };
  const completeFollowUp = async (id: string) => {
    setCrmBusy(id);
    try {
      await updateFollowUp(id, { status: "done" });
      sonner.success("Follow-up marked done");
      reload();
    } catch (err) {
      sonner.error(err instanceof Error ? err.message : "Could not update the follow-up");
    } finally {
      setCrmBusy("");
    }
  };
  // Share a proposal: the server mints (or reuses) the token and stamps
  // `share_sent_at`, then the link is copied for WhatsApp — the client never
  // forges the URL, and re-sharing a thread keeps one stable link.
  const shareProposalLink = async (job: PortalJob) => {
    setCrmBusy(job.id);
    try {
      const { shareUrl } = await shareProposal(job.id);
      const url = absoluteShareUrl(shareUrl);
      try {
        await navigator.clipboard.writeText(url);
        sonner.success(`Share link for ${job.number} copied`);
      } catch {
        // Insecure context (no clipboard API): open it so it can be copied by hand.
        window.open(url, "_blank", "noopener");
        sonner.success(`Share link for ${job.number} opened`);
      }
      reload();
    } catch (err) {
      sonner.error(err instanceof Error ? err.message : "Could not share the proposal");
    } finally {
      setCrmBusy("");
    }
  };
  // Lifecycle transitions go through the server (PATCH /api/jobs/:id/status), so
  // the list always reflects the job's real state.
  const setStatus = async (job: Job, status: "In Progress" | "Completed") => {
    setSaving(true);
    try {
      await setJobStatus(job.dbId, status);
      notify(status === "Completed" ? "Job completed" : "Job started");
      setSelected(null);
      reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not update the job");
    } finally {
      setSaving(false);
    }
  };
  // Work still on the technician's plate — finished jobs drop out of this set
  // the moment they are completed, so every "assigned" surface (list, badge,
  // dashboard) stops showing them.
  const openJobs = useMemo(() => jobs.filter((job) => job.status !== "Completed"), [jobs]);
  const filteredJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          // Finished work leaves the assigned list as soon as it is completed;
          // it stays reachable only through the explicit "Completed" segment.
          (filter === "Completed" || job.status !== "Completed") &&
          (filter === "All" || job.status === filter) &&
          `${job.title} ${job.customer} ${job.id} ${job.place}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [jobs, filter, query],
  );
  const filteredLeads = useMemo(
    () =>
      leads.filter((lead) =>
        `${lead.name} ${lead.stage}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [leads, query],
  );
  const filteredFollowUps = followUps;
  const filteredFeedback = feedback;
  const navTo = (label: string) => {
    setActive(label);
    setMobileMenu(false);
    setFilter("All");
    setQuery("");
  };
  const primaryAction =
    role === "Technician"
      ? "View my jobs"
      : role === "Sales"
        ? "New client"
        : role === "Supervisor"
          ? "View team"
          : "View leads";
  const doPrimary = () => {
    if (role === "Sales") {
      setLeadOpen(true);
      return;
    }
    navTo(role === "Technician" ? "My jobs" : role === "Supervisor" ? "Team" : "Leads");
  };
  const isDashboard = active === "Overview";
  const isJobView = active === "My jobs" || active === "Schedule";
  const isLeadView = active === "Leads" || active === "Follow-ups";
  const isTicketView = active === "Team" || active === "Feedback";
  const isConcernsView = active === "Concerns";
  const isProposalView = active === "Proposals";
  const openItem = (job: Job) => {
    setSelected(job);
  };
  // ── Everything below is derived from the employee's own records only ────────
  const openFollowUps = followUps.filter(
    (item) => !["done", "completed"].includes(item.status.toLowerCase()),
  );
  const metrics = useMemo(() => {
    const open = openJobs;
    const pipeline = leads.reduce((sum, lead) => sum + (lead.value ?? 0), 0);
    const assigned = crew.reduce((sum, member) => sum + member.assigned, 0);
    const rating = feedback.length
      ? (feedback.reduce((sum, row) => sum + row.rating, 0) / feedback.length).toFixed(1)
      : "—";
    if (role === "Technician") {
      return [
        {
          label: "Jobs assigned",
          value: String(open.length),
          detail: `${jobs.length - open.length} completed`,
          icon: BriefcaseBusiness,
          tone: "lime",
        },
        {
          label: "In progress",
          value: String(jobs.filter((job) => job.status === "In progress").length),
          detail: "Started by you",
          icon: Play,
          tone: "mint",
        },
        {
          label: "Completed",
          value: String(jobs.filter((job) => job.status === "Completed").length),
          detail: "All time",
          icon: CheckCircle2,
          tone: "blue",
        },
        {
          label: "Next job",
          value: openJobs[0]?.time ?? "—",
          detail: openJobs[0]?.customer ?? "Nothing scheduled",
          icon: CalendarDays,
          tone: "peach",
        },
      ];
    }
    if (role === "Sales") {
      return [
        {
          label: "Pipeline value",
          value: pipeline ? `UGX ${(pipeline / 1000000).toFixed(1)}M` : "—",
          detail: `${leads.length} leads assigned`,
          icon: Wallet,
          tone: "lime",
        },
        {
          label: "My leads",
          value: String(leads.filter((lead) => lead.mine).length),
          detail: `${leads.length - leads.filter((lead) => lead.mine).length} unassigned`,
          icon: Target,
          tone: "mint",
        },
        {
          label: "Follow-ups due",
          value: String(openFollowUps.length),
          detail: openFollowUps[0]?.title ?? "Nothing pending",
          icon: ClipboardCheck,
          tone: "blue",
        },
        {
          label: "Next follow-up",
          value: openFollowUps[0]?.dueAt ? formatJobDay(openFollowUps[0].dueAt) : "—",
          detail: openFollowUps[0]?.type ?? "No follow-ups",
          icon: CalendarDays,
          tone: "peach",
        },
      ];
    }
    if (role === "Supervisor") {
      return [
        {
          label: "Team size",
          value: String(crew.length),
          detail: `${crew.filter((m) => m.open > 0).length} with open work`,
          icon: Users,
          tone: "lime",
        },
        {
          label: "Job assignments",
          value: String(assigned),
          detail: "Across the whole crew",
          icon: BriefcaseBusiness,
          tone: "mint",
        },
        {
          label: "Pipeline value",
          value: pipeline ? `UGX ${(pipeline / 1000000).toFixed(1)}M` : "—",
          detail: `${leads.length} open leads`,
          icon: Wallet,
          tone: "blue",
        },
        {
          label: "Follow-ups due",
          value: String(openFollowUps.length),
          detail: "Owned by your roles",
          icon: ClipboardCheck,
          tone: "peach",
        },
      ];
    }
    return [
      {
        label: "Leads handled",
        value: String(leads.length),
        detail: `${leads.filter((lead) => lead.mine).length} owned by you`,
        icon: Target,
        tone: "lime",
      },
      {
        label: "Follow-ups open",
        value: String(openFollowUps.length),
        detail: openFollowUps[0]?.title ?? "Nothing pending",
        icon: ClipboardCheck,
        tone: "mint",
      },
      {
        label: "Customer rating",
        value: rating === "—" ? "—" : `${rating}★`,
        detail: `${feedback.length} responses`,
        icon: MessageSquare,
        tone: "blue",
      },
      {
        label: "Open work",
        value: String(jobs.filter((job) => job.status !== "Completed").length),
        detail: "Jobs assigned to you",
        icon: BriefcaseBusiness,
        tone: "peach",
      },
    ];
  }, [role, jobs, openJobs, leads, followUps, feedback, crew]);
  const activities = useMemo(
    () =>
      jobs.slice(0, 4).map((job) => ({
        icon: job.status === "Completed" ? CheckCircle2 : BriefcaseBusiness,
        title: `${job.id} · ${job.status}`,
        desc: `${job.title}${job.customer ? " — " + job.customer : ""}`,
        time: job.time,
        tone: job.status === "Completed" ? "mint" : "blue",
      })),
    [jobs],
  );
  const nextUp = useMemo(() => {
    const next = jobs.find((job) => job.status !== "Completed");
    if (next)
      return { title: next.title, detail: `${next.time}${next.place ? " · " + next.place : ""}` };
    const follow = openFollowUps[0];
    if (follow)
      return {
        title: follow.title,
        detail: follow.dueAt ? `Due ${formatJobDay(follow.dueAt)}` : follow.type,
      };
    if (leads[0]) return { title: leads[0].name, detail: leads[0].stage };
    return { title: "Nothing scheduled", detail: "Your queue is clear" };
  }, [jobs, openFollowUps, leads]);
  const attention = useMemo(() => {
    const next = jobs.find((job) => job.status !== "Completed");
    if (role === "Technician") {
      return next
        ? {
            title: `Next job: ${next.title}`,
            detail: `${next.id} · ${next.customer}${next.place ? " · " + next.place : ""} · ${next.time}`,
            actionLabel: "Open job",
            action: () => openItem(next),
          }
        : {
            title: "No jobs assigned to you",
            detail: "Your supervisor assigns work here — it will appear in your bell and job list.",
            actionLabel: "",
            action: () => undefined,
          };
    }
    if (role === "Sales") {
      return openFollowUps.length
        ? {
            title: `${openFollowUps.length} follow-up${openFollowUps.length > 1 ? "s" : ""} due`,
            detail: `${openFollowUps[0]?.title} · ${openFollowUps[0]?.type}`,
            actionLabel: "Open follow-ups",
            action: () => navTo("Follow-ups"),
          }
        : {
            title: "No follow-ups due",
            detail: `${leads.length} leads in your pipeline.`,
            actionLabel: "View leads",
            action: () => navTo("Leads"),
          };
    }
    if (role === "Supervisor") {
      return {
        title: `${crew.length} staff on the team`,
        detail: `${crew.reduce((sum, member) => sum + member.assigned, 0)} job assignments in flight.`,
        actionLabel: "View team",
        action: () => navTo("Team"),
      };
    }
    return {
      title: `${feedback.length} customer responses`,
      detail: feedback[0]
        ? `${feedback[0].customer} rated ${feedback[0].rating}★`
        : "No feedback recorded yet.",
      actionLabel: "View feedback",
      action: () => navTo("Feedback"),
    };
  }, [role, jobs, leads, openFollowUps, crew, feedback]);
  // Proposed orders (sales role): the same row language as the job list, with
  // Share as the only action — confirming needs a manager's capability.
  const proposalList = () => (
    <div className="job-list">
      {proposals.map((job) => (
        <div className="job-row" key={job.id}>
          <div className="job-time">
            <span className="time-icon">
              <Clock3 size={17} />
            </span>
            <span>{formatJobDay(job.date)}</span>
          </div>
          <div className="job-info">
            <div className="job-title-line">
              <strong>
                {job.number} · {job.service}
              </strong>
            </div>
            <span>
              {job.customer}
              <span className="dot-separator">·</span>
              {job.revenue ? `UGX ${job.revenue.toLocaleString()}` : "Price on survey"}
            </span>
          </div>
          <span className="status proposed">
            <span className="status-dot" />
            Proposed
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={crmBusy === job.id}
            onClick={() => shareProposalLink(job)}
          >
            <Share2 size={15} /> {crmBusy === job.id ? "Sharing…" : "Share"}
          </Button>
        </div>
      ))}
      {proposals.length === 0 && (
        <div className="empty">
          No proposals yet — raise your first order proposal and a manager will confirm it.
        </div>
      )}
    </div>
  );
  const jobList = (limit?: number) => (
    <div className="job-list">
      {(limit ? filteredJobs.slice(0, limit) : filteredJobs).map((job) => (
        <div className="job-row" key={job.id}>
          <div className="job-time">
            <span className="time-icon">
              <Clock3 size={17} />
            </span>
            <span>{job.time}</span>
          </div>
          <div className="job-info">
            <div className="job-title-line">
              <strong>{job.title}</strong>
            </div>
            <span>
              {job.customer}
              {job.place ? (
                <>
                  <span className="dot-separator">·</span> {job.place}
                </>
              ) : null}
            </span>
          </div>
          <span className={`status ${job.status.toLowerCase().replace(" ", "-")}`}>
            <span className="status-dot" />
            {job.status}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`View ${job.title}`}
            title="View job"
            onClick={() => openItem(job)}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
      ))}
      {filteredJobs.length === 0 && (
        <div className="empty">
          {filter === "Completed"
            ? "No completed jobs yet."
            : filter === "All"
              ? "No jobs are assigned to you yet."
              : `No ${filter.toLowerCase()} jobs right now.`}
        </div>
      )}
    </div>
  );

  const leadList = (limit?: number) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Opportunity</th>
            <th>Value</th>
            <th>Stage</th>
            <th>Owner</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {filteredLeads.slice(0, limit).map((lead) => (
            <tr key={lead.id}>
              <td>
                <div className="person-cell">
                  <span className="person-icon">
                    {lead.name
                      .split(/\s+/)
                      .map((part) => part.charAt(0))
                      .join("")
                      .slice(0, 2)}
                  </span>
                  <span>
                    <strong>{lead.name}</strong>
                    <small>{lead.stage}</small>
                  </span>
                </div>
              </td>
              <td className="strong-cell">
                {lead.value ? `UGX ${lead.value.toLocaleString()}` : "—"}
              </td>
              <td>
                <span className="status stage">{lead.stage}</span>
              </td>
              <td className="muted-cell">{lead.mine ? "Yours" : "Unassigned"}</td>
              <td>
                <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                  {lead.stage !== "Won" && lead.stage !== "Lost" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={crmBusy === lead.id}
                      onClick={() => void advanceLead(lead.id, lead.stage)}
                      title={`Move ${lead.name} to the next stage`}
                    >
                      Advance
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setScheduleLeadId({ id: lead.id, name: lead.name })}
                    title={`Schedule a follow-up with ${lead.name}`}
                  >
                    Follow-up
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLogLeadId({ id: lead.id, name: lead.name })}
                    title={`Log an interaction with ${lead.name}`}
                  >
                    Log
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`View ${lead.name}`}
                    title="View details"
                    onClick={() => setToast(`${lead.name} · ${lead.stage}`)}
                  >
                    <ChevronRight size={18} />
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filteredLeads.length === 0 && <div className="empty">No leads are assigned to you yet.</div>}
    </div>
  );
  const followUpList = () => (
    <div className="simple-list">
      {filteredFollowUps.map((item) => (
        <div key={item.id}>
          <span className="list-icon">
            <ClipboardCheck size={18} />
          </span>
          <span>
            <strong>{item.title}</strong>
            <small>
              {item.type}
              {item.dueAt ? " · due " + formatJobDay(item.dueAt) : ""}
              {item.notes ? " · " + item.notes : ""}
            </small>
          </span>
          {item.status === "pending" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={crmBusy === item.id}
              onClick={() => void completeFollowUp(item.id)}
            >
              Done
            </Button>
          ) : (
            <b>{item.status}</b>
          )}
        </div>
      ))}
      {filteredFollowUps.length === 0 && <div className="empty">No follow-ups are due.</div>}
    </div>
  );
  const crewList = (limit?: number) => (
    <div className="team-list">
      {crew.slice(0, limit).map((member, i) => (
        <div className="team-row" key={member.id}>
          <span className="rank">{String(i + 1).padStart(2, "0")}</span>
          <span className="person-icon">
            {member.name
              .split(/\s+/)
              .map((part) => part.charAt(0))
              .join("")
              .slice(0, 2)}
          </span>
          <strong>{member.name}</strong>
          <span className="team-revenue">
            {member.revenue ? `UGX ${(member.revenue / 1000000).toFixed(1)}M` : "—"}
          </span>
          <span className="team-percent">{member.assigned} assigned</span>
        </div>
      ))}
      {crew.length === 0 && <div className="empty">No staff records yet.</div>}
    </div>
  );
  const feedbackList = (limit?: number) => (
    <div className="ticket-list">
      {filteredFeedback.slice(0, limit).map((row) => (
        <div className="ticket-row" key={row.id}>
          <span className="ticket-marker">
            <MessageSquare size={16} />
          </span>
          <span>
            <strong>{row.customer}</strong>
            <small>{row.comment || "No comment left"}</small>
          </span>
          <b>{row.rating}*</b>
        </div>
      ))}
      {filteredFeedback.length === 0 && (
        <div className="empty">No customer feedback recorded yet.</div>
      )}
    </div>
  );

  if (sessionLoading)
    return (
      <main className="signin">
        <div className="signin-side">
          <div className="signin-form">
            <p className="eyebrow">GABFIX HOME SOLUTIONS</p>
            <h2>Restoring your workspace…</h2>
            <p>Checking your signed-in session.</p>
          </div>
        </div>
      </main>
    );
  if (!session)
    return (
      <main className="signin">
        <div className="signin-brand">
          <div className="signin-logo">
            <img src={LOGO_SRC} alt="Gabfix" />
            <strong>
              Gabfix <small>EMPLOYEE PORTAL</small>
            </strong>
          </div>
          <div>
            <p className="eyebrow">GABFIX HOME SOLUTIONS</p>
            <h1>
              Work made clear.
              <br />
              Service made better.
            </h1>
            <p>One workspace for every job, every customer, every day.</p>
          </div>
          <small>Kampala, Uganda</small>
        </div>
        <div className="signin-side">
          <form onSubmit={submitSignIn} className="signin-form">
            <p className="eyebrow">STAFF ACCESS</p>
            <h2>Welcome back</h2>
            <p>Sign in to your Gabfix workspace.</p>
            <label>
              Name or email
              <input
                required
                value={inputName}
                onChange={(e) => setInputName(e.target.value)}
                placeholder="Your name or email"
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <span className="password-field">
                <input
                  required
                  type={passwordShown ? "text" : "password"}
                  value={inputPassword}
                  onChange={(e) => setInputPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={passwordShown ? "Hide password" : "Show password"}
                  aria-label={passwordShown ? "Hide password" : "Show password"}
                  onClick={() => setPasswordShown(!passwordShown)}
                >
                  {passwordShown ? <EyeOff size={17} /> : <Eye size={17} />}
                </Button>
              </span>
            </label>
            <Button type="submit" className="signin-submit" disabled={loginBusy}>
              {loginBusy ? "Signing in…" : "Sign in"}
            </Button>
            {loginError && (
              <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {loginError}
              </p>
            )}
            <small>
              New here? Your Admin's invite code creates your account —{" "}
              <Link to="/sign-up" className="font-semibold text-primary hover:underline">
                Sign up
              </Link>
            </small>
          </form>
        </div>
      </main>
    );

  return (
    <div className="portal-shell">
      {mobileMenu && <div className="mobile-scrim" onClick={() => setMobileMenu(false)} />}
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <img src={LOGO_SRC} alt="Gabfix" />
          <div>
            <strong>
              Gabfix<span className="brand-accent">.</span>
            </strong>
            <small>EMPLOYEE PORTAL</small>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="mobile-close"
            onClick={() => setMobileMenu(false)}
            aria-label="Close menu"
          >
            <X size={19} />
          </Button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          {navigation[role].map(({ label, icon: Icon }) => {
            // Assigned list excludes finished work (see filteredJobs), so the
            // sidebar badge counts open jobs only.
            const count =
              label === "My jobs"
                ? openJobs.length
                : label === "Proposals"
                  ? proposals.length
                  : 0;
            return (
              <Button
                key={label}
                variant="ghost"
                className={`nav-item ${active === label ? "active" : ""}`}
                onClick={() => navTo(label)}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{label}</span>
                {count ? <span className="nav-badge">{count}</span> : null}
              </Button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-label">ACCOUNT</div>
          <Button
            variant="ghost"
            className={`nav-item ${active === "Settings" ? "active" : ""}`}
            onClick={() => navTo("Settings")}
          >
            <Settings2 size={19} />
            <span>Settings</span>
          </Button>
          <Button
            variant="ghost"
            className={`nav-item ${active === "Help" ? "active" : ""}`}
            onClick={() => navTo("Help")}
          >
            <HelpCircle size={19} />
            <span>Help & support</span>
          </Button>
          <div className="sidebar-profile">
            <span className="avatar">{initials}</span>
            <div>
              <strong>{displayName}</strong>
              <small>{roleTitle(session.role)}</small>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Account options"
              title="Account options"
              onClick={() => setProfile(!profile)}
            >
              <MoreHorizontal size={19} />
            </Button>
            {profile && (
              <div className="profile-popover">
                <p>{roleTitle(session.role)}</p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void portalApi.auth.signOut();
                    setSession(null);
                    setJobs([]);
                    setActive("Overview");
                    setProfile(false);
                  }}
                >
                  <LogOut size={15} /> Sign out
                </Button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <Button
            variant="ghost"
            size="icon"
            className="menu-toggle"
            aria-label="Open menu"
            onClick={() => setMobileMenu(true)}
          >
            <Menu size={21} />
          </Button>
          <div className="header-crumb">
            Workspace <ChevronRight size={14} /> <strong>{active}</strong>
          </div>
          <div className="topbar-right">
            <label className="search-field">
              <Search size={18} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your workspace..."
                aria-label="Search workspace"
              />
            </label>
            <span className="header-divider" />
            <div className="notification-wrap">
              <PortalBell employeeId={session.id} />
            </div>
            <Button
              variant="ghost"
              className="top-profile"
              onClick={() => setProfile(!profile)}
              aria-label="Open profile"
            >
              <span className="avatar small">{initials}</span>
              <span className="top-profile-name">{displayName}</span>
              <ChevronDown size={15} />
            </Button>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {isDashboard ? "YOUR WORKSPACE" : "WORKSPACE / " + active.toUpperCase()}
              </p>
              <h1>{isDashboard ? `Good morning, ${displayFirst}.` : active}</h1>
              <p className="heading-subtitle">
                {isDashboard
                  ? role === "Technician"
                    ? "Here’s what your day looks like. Let’s get to work."
                    : role === "Sales"
                      ? "Stay close to every opportunity and your next follow-up."
                      : role === "Supervisor"
                        ? "Your team at a glance, and the decisions that move them forward."
                        : "The customers who need you are right here."
                  : active === "Settings"
                    ? "Your account and workspace preferences."
                    : active === "Help"
                      ? "Find the support you need."
                      : `Your ${active.toLowerCase()} at a glance.`}
              </p>
            </div>
            <div className="heading-controls">
              <span className="date-pill">
                <CalendarDays size={16} />
                {dateLabel}
              </span>
              {role === "Sales" && !isProposalView && (
                <Button variant="outline" onClick={() => setProposeOpen(true)}>
                  <Plus size={17} /> New proposal
                </Button>
              )}
              {isDashboard && (
                <Button className="action-button" onClick={doPrimary}>
                  {role === "Technician" ? <ArrowUpRight size={17} /> : <Plus size={18} />}{" "}
                  {primaryAction}
                </Button>
              )}
            </div>
          </div>
          {isDashboard && (
            <>
              <div className="section-caption">
                <span>AT A GLANCE</span>
                <span>
                  {role === "Technician"
                    ? "Your week in numbers"
                    : role === "Sales"
                      ? "Your sales snapshot"
                      : role === "Supervisor"
                        ? "Team snapshot"
                        : "Support snapshot"}
                </span>
              </div>
              <div className="metrics-grid">
                {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
                  <div className="metric-card" key={label}>
                    <div className={`metric-icon ${tone}`}>
                      <Icon size={20} strokeWidth={1.9} />
                    </div>
                    <span className="metric-label">{label}</span>
                    <strong>{value}</strong>
                    <small>{detail}</small>
                  </div>
                ))}
              </div>
              <div className="section-caption attention-caption">
                <span>YOUR PRIORITIES</span>
                <span>What needs your attention</span>
              </div>
              <section className="attention-band">
                <div className="attention-symbol">
                  <AlertCircle size={21} />
                </div>
                <div>
                  <strong>{attention.title}</strong>
                  <p>{attention.detail}</p>
                </div>
                <Button variant="outline" onClick={attention.action}>
                  {attention.actionLabel} <ArrowUpRight size={16} />
                </Button>
              </section>
              <div className="dashboard-columns">
                <section className="surface main-work">
                  <div className="surface-head">
                    <div>
                      <p className="eyebrow">
                        {role === "Technician"
                          ? "MY WORK"
                          : role === "Sales"
                            ? "YOUR PIPELINE"
                            : role === "Supervisor"
                              ? "TEAM ACTIVITY"
                              : "CUSTOMER SUPPORT"}
                      </p>
                      <h2>
                        {role === "Technician"
                          ? "Today’s jobs"
                          : role === "Sales"
                            ? "Opportunities to move"
                            : role === "Supervisor"
                              ? "Team performance"
                              : "Customer issues"}
                      </h2>
                    </div>
                    <Button
                      variant="ghost"
                      className="text-link"
                      onClick={() =>
                        navTo(
                          role === "Technician"
                            ? "My jobs"
                            : role === "Sales"
                              ? "Leads"
                              : role === "Supervisor"
                                ? "Team"
                                : "Tickets",
                        )
                      }
                    >
                      View all <ArrowUpRight size={16} />
                    </Button>
                  </div>
                  {role === "Technician"
                    ? jobList(3)
                    : role === "Sales"
                      ? leadList(3)
                      : role === "Supervisor"
                        ? crewList(3)
                        : role === "Support"
                          ? feedbackList(3)
                          : leadList(3)}
                </section>
                <div className="right-stack">
                  <section className="surface schedule-card">
                    <div className="surface-head">
                      <div>
                        <p className="eyebrow">ON THE CALENDAR</p>
                        <h2>
                          {role === "Technician"
                            ? "Your schedule"
                            : role === "Sales"
                              ? "This week"
                              : role === "Supervisor"
                                ? "Team schedule"
                                : "Upcoming follow-ups"}
                        </h2>
                      </div>
                      <CalendarDays size={19} className="subtle-icon" />
                    </div>
                    <div className="mini-calendar">
                      <div className="calendar-title">
                        <strong>{`${months[kampalaToday.getUTCMonth()]} ${kampalaToday.getUTCFullYear()}`}</strong>
                        <span>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Previous week"
                            onClick={() => setWeek(week - 1)}
                          >
                            <ChevronLeft size={17} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Next week"
                            onClick={() => setWeek(week + 1)}
                          >
                            <ChevronRight size={17} />
                          </Button>
                        </span>
                      </div>
                      <div className="week-days">
                        {Array.from({ length: 7 }, (_, i) => {
                          const d = new Date(today);
                          d.setDate(today.getDate() - ((today.getDay() + 6) % 7) + i + week * 7);
                          return (
                            <div
                              key={i}
                              className={d.toDateString() === today.toDateString() ? "today" : ""}
                            >
                              <small>{weekdays[d.getDay()]?.slice(0, 3)}</small>
                              <strong>{d.getDate()}</strong>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="up-next">
                      <span className="up-next-line" />
                      <div>
                        <small>UP NEXT</small>
                        <strong>{nextUp.title}</strong>
                        <p>{nextUp.detail}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      className="schedule-link"
                      onClick={() => navTo(role === "Support" ? "Follow-ups" : "Schedule")}
                    >
                      Open full schedule <ArrowUpRight size={15} />
                    </Button>
                  </section>
                  <section className="quick-card">
                    <div className="quick-decor">
                      <Wrench size={22} />
                    </div>
                    <p className="eyebrow">KEEP THINGS MOVING</p>
                    <h2>
                      {role === "Technician"
                        ? "Every detail counts."
                        : role === "Sales"
                          ? "Every follow-up counts."
                          : role === "Supervisor"
                            ? "Keep your team moving."
                            : "Make every response count."}
                    </h2>
                    <p>
                      {role === "Technician"
                        ? "Log your work as you go so your team stays in sync."
                        : role === "Sales"
                          ? "Capture the next step while the conversation is fresh."
                          : role === "Supervisor"
                            ? "A quick review helps your team move forward."
                            : "Keep customers informed at every step."}
                    </p>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        role === "Technician"
                          ? navTo("Timesheets")
                          : navTo(
                              role === "Sales"
                                ? "Follow-ups"
                                : role === "Supervisor"
                                  ? "Approvals"
                                  : "Tickets",
                            )
                      }
                    >
                      {role === "Technician" ? "Log time" : "Open work"} <ArrowUpRight size={16} />
                    </Button>
                  </section>
                </div>
              </div>
              <section className="surface activity-section">
                <div className="surface-head">
                  <div>
                    <p className="eyebrow">WHAT’S HAPPENED</p>
                    <h2>Recent activity</h2>
                  </div>
                  <span className="muted-note">Latest updates</span>
                </div>
                <div className="activity-grid">
                  {activities.map(({ icon: Icon, title, desc, time, tone }) => (
                    <div className="activity-item" key={title}>
                      <span className={`activity-icon ${tone}`}>
                        <Icon size={17} />
                      </span>
                      <div>
                        <strong>{title}</strong>
                        <p>{desc}</p>
                        <small>{time}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {!isDashboard && (
            <div className="detail-content">
              {isConcernsView && <ConcernsInbox />}
              {isJobView && (
                <>
                  <div className="toolbar">
                    <div className="segmented">
                      {["All", "Scheduled", "In progress", "Completed"].map((item) => (
                        <Button
                          key={item}
                          variant="ghost"
                          className={filter === item ? "chosen" : ""}
                          onClick={() => setFilter(item)}
                        >
                          {item}
                        </Button>
                      ))}
                    </div>
                    <span className="results-count">{filteredJobs.length} jobs</span>
                  </div>
                  <section className="surface listing-surface">
                    <div className="surface-head">
                      <div>
                        <p className="eyebrow">ASSIGNED WORK</p>
                        <h2>{active === "Schedule" ? "Upcoming assignments" : "Your jobs"}</h2>
                      </div>
                      <Filter size={18} className="subtle-icon" />
                    </div>
                    {jobList()}
                  </section>
                </>
              )}
              {isLeadView && (
                <>
                  <div className="toolbar">
                    <span className="results-count">
                      {active === "Follow-ups"
                        ? filteredFollowUps.length + " follow-ups"
                        : filteredLeads.length + " leads"}
                    </span>
                    {role === "Sales" && active === "Leads" && (
                      <Button size="sm" onClick={() => setLeadOpen(true)}>
                        <Plus size={16} /> New client
                      </Button>
                    )}
                    {role === "Sales" && active === "Follow-ups" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setScheduleLeadId({ id: "", name: "" })}
                      >
                        <Plus size={16} /> Schedule
                      </Button>
                    )}
                  </div>
                  <section className="surface listing-surface">
                    <div className="surface-head">
                      <div>
                        <p className="eyebrow">
                          {role === "Sales" ? "SALES WORKSPACE" : "TEAM WORKSPACE"}
                        </p>
                        <h2>
                          {active === "Follow-ups" ? "Your follow-ups" : "Leads assigned to you"}
                        </h2>
                      </div>
                    </div>
                    {active === "Follow-ups" ? followUpList() : leadList()}
                  </section>
                </>
              )}
              {isProposalView && (
                <>
                  <div className="toolbar">
                    <span className="results-count">{proposals.length} proposals</span>
                    <Button size="sm" onClick={() => setProposeOpen(true)}>
                      <Plus size={16} /> New proposal
                    </Button>
                  </div>
                  <section className="surface listing-surface">
                    <div className="surface-head">
                      <div>
                        <p className="eyebrow">ORDER PIPELINE</p>
                        <h2>Proposals awaiting confirmation</h2>
                      </div>
                    </div>
                    {proposalList()}
                  </section>
                </>
              )}
              {isTicketView && (
                <>
                  <div className="toolbar">
                    <span className="results-count">
                      {active === "Team"
                        ? crew.length + " staff"
                        : filteredFeedback.length + " responses"}
                    </span>
                  </div>
                  <section className="surface listing-surface">
                    <div className="surface-head">
                      <div>
                        <p className="eyebrow">
                          {active === "Team" ? "TEAM WORKSPACE" : "CUSTOMER CARE"}
                        </p>
                        <h2>{active === "Team" ? "Team workload" : "Customer feedback"}</h2>
                      </div>
                    </div>
                    {active === "Team" ? crewList() : feedbackList()}
                  </section>
                </>
              )}
              {!isJobView &&
                !isLeadView &&
                !isTicketView &&
                !isConcernsView &&
                !isProposalView && (
                <section className="surface listing-surface">
                  <div className="surface-head">
                    <div>
                      <p className="eyebrow">
                        {active === "Settings" ? "YOUR PROFILE" : "YOUR WORKSPACE"}
                      </p>
                      <h2>{active}</h2>
                    </div>
                  </div>
                  {active === "Settings" ? (
                    <div className="settings-panel">
                      <div>
                        <span>Name</span>
                        <strong>{displayName}</strong>
                      </div>
                      <div>
                        <span>Role</span>
                        <strong>{roleTitle(session.role)}</strong>
                      </div>
                      <div>
                        <span>Workspace</span>
                        <strong>Gabfix Home Solutions</strong>
                      </div>
                    </div>
                  ) : active === "Help" ? (
                    <div className="help-panel">
                      <HelpCircle size={26} />
                      <strong>Need a hand?</strong>
                      <p>
                        Contact your Gabfix operations team for account access, assignments, or
                        customer requests.
                      </p>
                    </div>
                  ) : (
                    <div className="simple-list">
                      <div>
                        <span className="list-icon">
                          <CalendarDays size={18} />
                        </span>
                        <span>
                          <strong>Nothing assigned here</strong>
                          <small>No records in this section are linked to you</small>
                        </span>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </main>
      </div>
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside
            className="job-drawer"
            onClick={(e) => e.stopPropagation()}
            aria-label="Job details"
          >
            <div className="drawer-top">
              <span className="eyebrow">JOB DETAILS · {selected.id}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close job details"
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </Button>
            </div>
            <h2>{selected.title}</h2>
            <span className={`status ${selected.status.toLowerCase().replace(" ", "-")}`}>
              <span className="status-dot" />
              {selected.status}
            </span>
            <div className="drawer-divider" />
            <div className="detail-facts">
              <div>
                <Users size={18} />
                <span>
                  <small>CUSTOMER</small>
                  <strong>{selected.customer}</strong>
                </span>
              </div>
              <div>
                <MapPin size={18} />
                <span>
                  <small>LOCATION</small>
                  <strong>{selected.place || "Not recorded"}</strong>
                </span>
              </div>
              <div>
                <CalendarDays size={18} />
                <span>
                  <small>SCHEDULED</small>
                  <strong>{selected.time}</strong>
                </span>
              </div>
              <div>
                <CircleDollarSign size={18} />
                <span>
                  <small>VALUE</small>
                  <strong>UGX {selected.revenue.toLocaleString()}</strong>
                </span>
              </div>
            </div>
            <div className="drawer-divider" />
            <JobChecklistPanel
              jobId={selected.dbId}
              currentStage={selected.status === "In progress" ? "In Progress" : selected.status}
              onChecklistReady={(done: number, total: number) => setChecklistReady({ done, total })}
            />
            <div className="drawer-actions">
              {selected.status !== "Completed" && selected.status !== "In progress" && (
                <Button onClick={() => void setStatus(selected, "In Progress")} disabled={saving}>
                  <Play size={17} /> Start job
                </Button>
              )}
              {selected.status !== "Completed" &&
                (() => {
                  const gate = checklistReady
                    ? checklistGate(
                        selected.status === "In progress" ? "In Progress" : selected.status,
                        checklistReady.done,
                        checklistReady.total,
                      )
                    : null;
                  return (
                    <>
                      <Button
                        onClick={() => void setStatus(selected, "Completed")}
                        disabled={saving || (gate !== null && !gate.ready && gate.mode === "hard")}
                      >
                        <Check size={17} /> Complete job
                      </Button>
                      {gate !== null && !gate.ready && gate.mode === "advisory" && (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => {
                            notify(
                              "Skipping remaining checklist items — logged on the job timeline.",
                            );
                            void setStatus(selected, "Completed");
                          }}
                        >
                          Skip remaining items
                        </button>
                      )}
                      {gate !== null && !gate.ready && gate.mode === "hard" && (
                        <span className="muted-note">{gate.reason}</span>
                      )}
                    </>
                  );
                })()}
              {selected.status !== "Completed" && raiseConcernOpen && (
                <ConcernForm
                  jobId={selected.dbId}
                  jobNumber={selected.id}
                  customer={selected.customer}
                  onRaised={() => {
                    setRaiseConcernOpen(false);
                    reload();
                  }}
                />
              )}
              {selected.status !== "Completed" && (
                <Button variant="outline" size="sm" onClick={() => setRaiseConcernOpen((o) => !o)}>
                  <AlertCircle size={16} /> {raiseConcernOpen ? "Cancel concern" : "Raise concern"}
                </Button>
              )}
              {selected.status === "Completed" && (
                <span className="muted-note">Completed — nothing further to do.</span>
              )}
            </div>
          </aside>
        </div>
      )}
      {toast && (
        <div className="toast-message" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
      {role === "Sales" && (
        <>
          <LeadModal
            open={leadOpen}
            onClose={() => setLeadOpen(false)}
            onSaved={() => reload()}
          />
          <ProposeOrderModal
            open={proposeOpen}
            onClose={() => setProposeOpen(false)}
            onSaved={() => reload()}
            customers={customers}
            services={services}
          />
          <ScheduleFollowUpModal
            open={scheduleLeadId !== null}
            defaults={
              scheduleLeadId && scheduleLeadId.id
                ? { leadId: scheduleLeadId.id, subject: scheduleLeadId.name }
                : {}
            }
            onClose={() => setScheduleLeadId(null)}
            onSaved={() => reload()}
          />
          <InteractionModal
            open={logLeadId !== null}
            defaults={
              logLeadId ? { leadId: logLeadId.id, subject: logLeadId.name } : {}
            }
            onClose={() => setLogLeadId(null)}
            onSaved={() => reload()}
          />
        </>
      )}
    </div>
  );
}
