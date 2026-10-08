import { toast } from "sonner";
import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileText,
  Home,
  MapPin,
  Menu,
  MoreHorizontal,
  Plus,
  Radio,
  Search,
  WalletCards,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { roleCopy, type Job, type Role } from "@/lib/portal-data";
import { setJobStatus, subscribeToJobEvents, useMyJobs, type PortalJob } from "@/lib/workspace";
import { useEffect, useMemo, useState } from "react";
import { useBeacon } from "@/lib/beacon";
import { useDocumentTitle } from "@/lib/use-document-title";
import { useSession } from "@/lib/session";
import { TimesheetsPage } from "@/pages/timesheets";
import { CostsPage } from "@/pages/costs";
import { DocumentsPage } from "@/pages/documents";

const roles: Role[] = ["Technician", "Sales", "Supervisor", "Accountant-field"];
const nav = [
  { label: "My day", icon: Home },
  { label: "My jobs", icon: BriefcaseBusiness, count: 3 },
  { label: "Schedule", icon: CalendarDays },
  { label: "Timesheets", icon: Clock3 },
  { label: "Costs", icon: WalletCards, count: 2 },
  { label: "Documents", icon: FileText },
]; // Board labels: live component keyed by label.
function StatusBadge({ status }: { status: Job["status"] }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      <span />
      {status}
    </span>
  );
}

export default function PortalPage() {
  useDocumentTitle(
    "My Day — Gabfix Portal",
    "Gabfix Home Solutions employee operations portal for jobs, crews, sales, and field costs.",
  );
  const { session } = useSession();
  const [role, setRole] = useState<Role>("Technician");
  const {
    jobs: liveJobs,
    error: jobsError,
    assignedJobIds,
  } = useMyJobs(session?.name ?? null, session?.id ?? null);
  const [tick, setTick] = useState(0);
  const [transition, setTransition] = useState<PortalJob | null>(null);
  const [acting, setActing] = useState(false);
  const refresh = () => setTick((t) => t + 1);
  useEffect(() => subscribeToJobEvents(refresh), []);
    const [mobileNav, setMobileNav] = useState(false);
  const [active, setActive] = useState("My day");
  const copy = roleCopy[role];

  // Live boards are keyed by nav label; only Timesheets, Costs and Documents
  // render real server-backed pages. A board earns its nav entry only when it
  // renders a live component here — no toast doubles as a "not yet live"
  // backlog. (Schedule stays a static preview until the server schedule
  // endpoint exists.)
  const activeEmployeeId: string | null = session?.id ?? null;
  const board =
    active === "Timesheets" ? (
      <TimesheetsPage employeeId={activeEmployeeId!} />
    ) : active === "Costs" ? (
      <CostsPage employeeId={activeEmployeeId!} />
    ) : active === "Documents" ? (
      <DocumentsPage employeeId={activeEmployeeId!} />
    ) : null;

  // Sidebar/Nav + job list render identically across every preview role;
  // only the KPI strip and its values derive from roleCopy (roleCopy stays
  // used for copy, not for gating navigation or job rows).
  // The sidebar is role-identical — the nav list is the live checklist and
  // the same for every preview role. Only the KPI strip (role-derived copy)
  // and the KPI values change per role; the job list itself renders
  // identically so the portal surface does not double as a role pivot menu.
    const focusJob = liveJobs?.find((j) => j.mine && j.status === "In Progress") ?? null;
  // Role-derived KPI strip (role is a preview selector, not a nav gate).
  const kpis =
    role === "Sales"
      ? [
          ["Open pipeline", "UGX 8.4M", "12 opportunities"],
          ["Quotes due", "2", "Before 5:00 PM"],
          ["Commission", "UGX 540K", "This month"],
          ["Won this month", "6", "+2 vs August"],
        ]
      : role === "Supervisor"
        ? [
            ["Crew active", "6 / 7", "1 unavailable"],
            ["Jobs today", "9", "4 completed"],
            ["Needs attention", "2", "1 escalation"],
            ["On-time rate", "92%", "+4% this week"],
          ]
        : role === "Accountant-field"
          ? [
              ["Submitted today", "UGX 186K", "4 entries"],
              ["Draft entries", "2", "Not yet submitted"],
              ["Job costs", "UGX 142K", "Category 1"],
              ["Sales costs", "UGX 44K", "Category 2"],
            ]
          : [
              ["Jobs today", "3", "1 in progress"],
              ["Hours logged", "3h 24m", "of 8 hours"],
              ["Tasks complete", "4 / 7", "57% done"],
              ["Week earnings", "UGX 485K", "+8% vs last week"],
            ];

  const selectNav = (label: string) => {
    setActive(label);
    setMobileNav(false);
    // A board earns its nav entry only when it renders a live component; the
    // map above (liveBoards) is the single gate. No toast doubles as a
    // "not yet live" backlog — the label list is the live checklist.
  };

  return (
    <div className="portal-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <img src="/gabfix-logo.png" alt="Gabfix" />
          <div>
            <strong>Gabfix</strong>
            <span>EMPLOYEE PORTAL</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="mobile-close"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>
        <nav aria-label="Main navigation">
          <p>WORKSPACE</p>
          {nav.map(({ label, icon: Icon, count }) => (
            <Button
              key={label}
              variant="ghost"
              className={`nav-item ${active === label ? "nav-active" : ""}`}
              onClick={() => selectNav(label)}
            >
              <Icon /> <span>{label}</span>
              {count ? <b>{count}</b> : null}
            </Button>
          ))}
          <p>FIELD</p>
          <Button
            variant="ghost"
            className={`nav-item ${active === "My trail" ? "nav-active" : ""}`}
            onClick={() => selectNav("My trail")}
          >
            <Radio />
            <span>My trail</span>
            <i className="online-dot" />
          </Button>
        </nav>
        <div className="sidebar-foot">
          <div className="support-mark">
            <Wrench />
          </div>
          <div>
            <strong>Need support?</strong>
            <span>Contact operations</span>
          </div>
        </div>
      </aside>

      <div className="portal-main">
        <header className="topbar">
          <Button
            variant="ghost"
            size="icon"
            className="menu-button"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
          <div className="searchbox">
            <Search />
            <input aria-label="Search portal" placeholder="Search jobs, customers, documents..." />
          </div>
          <div className="header-actions">
            <span className="sync-state">
              <i /> Live
            </span>
            <Button variant="ghost" size="icon" aria-label="Notifications" className="bell">
              <Bell />
              <b>3</b>
            </Button>
            <div className="profile">
              <div className="avatar">
                {session
                  ? session.name
                      .split(" ")
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()
                  : "…"}
              </div>
              <div>
                <strong>{session?.name ?? "Loading…"}</strong>
                <span>{session?.role ?? role}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="content">
          <div className="page-heading">
            <div>
              <p>{copy.eyebrow}</p>
              <h1>{copy.title}</h1>
              <span>{copy.subtitle}</span>
            </div>
            <div className="heading-actions">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                aria-label="Preview employee role"
              >
                {roles.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <Button
                onClick={() =>
                  toast.success(
                    role === "Accountant-field" ? "Expense form opened" : "New task created",
                  )
                }
              >
                <Plus />
                {role === "Accountant-field" ? "Add expense" : "New task"}
              </Button>
            </div>
          </div>

          <section className="kpi-strip" aria-label="My day summary">
            {kpis.map(([label, value, note], i) => (
              <article key={label}>
                <div className="kpi-icon">
                  {[<BriefcaseBusiness />, <Clock3 />, <ClipboardCheck />, <CircleDollarSign />][i]}
                </div>
                <div>
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <small>{note}</small>
                </div>
              </article>
            ))}
          </section>

          <div className="dashboard-grid">
            <section className="panel jobs-panel">
              <div className="panel-head">
                <div>
                  <h2>
                    {role === "Supervisor"
                      ? "Crew jobs"
                      : role === "Sales"
                        ? "Quote follow-ups"
                        : role === "Accountant-field"
                          ? "Recent submissions"
                          : "Today’s jobs"}
                  </h2>
                  <p> {(liveJobs ?? []).length} jobs in your view</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => toast("All items loaded")}>
                  View all
                </Button>
              </div>
              <div className="job-list">
                {(liveJobs ?? [])
                  // Role identifies which board the user is previewing via the
                  // topbar <select>; it does not gate the job rows or the right
                  // stack, so the sidebar stays role-identical for every role.
                  .slice(0, 6)
                  .map((lj) => (
                    <button className="job-row" key={lj.id} onClick={() => setTransition(lj)}>
                      <div className="time">
                        <strong>{lj.date}</strong>
                        <span>{lj.number}</span>
                      </div>
                      <div className="job-title">
                        <strong>{lj.service}</strong>
                        <span>
                          {lj.customer} · {lj.mine ? "assigned to you" : "crew"}
                        </span>
                      </div>
                      <span
                        className={`status status-` + lj.status.toLowerCase().replace(" ", "-")}
                      >
                        <span />
                        {lj.status}
                      </span>
                      <span className="job-value">
                        {new Intl.NumberFormat("en-UG", {
                          style: "currency",
                          currency: "UGX",
                          maximumFractionDigits: 0,
                        }).format(lj.revenue)}
                      </span>
                      <ChevronRight />
                    </button>
                  ))}
                {liveJobs === null && !jobsError && (
                  <p className="px-4 py-6 text-sm text-muted-foreground">Loading jobs…</p>
                )}
                {jobsError && <p className="px-4 py-6 text-sm text-destructive">{jobsError}</p>}
                              </div>
            </section>

            <aside className="right-stack">
              <section className="panel focus-panel">
                <div className="panel-head">
                  <div>
                    <h2>Current focus</h2>
                    <p>{focusJob ? focusJob.number + " " + focusJob.status : "No job in progress"}</p>
                  </div>
                  <MoreHorizontal />
                </div>
                <h3>{focusJob?.service ?? "No job in progress"}</h3>
                <p className="address">
                  <MapPin /> {focusJob?.customer ?? "No job in progress"}
                </p>
                <div className="progress-track">
                  <span />
                </div>
                <div className="steps">
                  <span>Accepted</span>
                  <span className="done">Started</span>
                  <span>Complete</span>
                </div>
                <Button className="w-full" onClick={() => toast.success("Job marked complete")}>
                  Complete job <ChevronRight />
                </Button>
              </section>
              <section className="panel schedule-panel">
                <div className="panel-head">
                  <div>
                    <h2>Next up</h2>
                    <p>Today’s remaining schedule</p>
                  </div>
                  <CalendarDays />
                </div>
                                {(liveJobs ?? [])
                  .filter((j) => j.status === "Scheduled")
                  .slice(0, 2)
                  .map((j) => (
                    <div className="mini-job" key={j.id}>
                      <strong>{j.date}</strong>
                      <div>
                        <b>{j.service}</b>
                        <span>{j.customer}</span>
                      </div>
                    </div>
                  ))}
              </section>
            </aside>
          </div>
          {board && <div className="board-slot">{board}</div>}
        </main>
      </div>

      {active === "My trail" && <TrailPanel />}

            {transition && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            aria-label="Close dialog"
            className="absolute inset-0 bg-black/50"
            onClick={() => setTransition(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-md rounded-t-2xl border border-border bg-card p-6 shadow-2xl sm:rounded-2xl"
          >
            <p className="font-mono text-xs text-primary">{transition.number}</p>
            <h3 className="mt-1 text-lg font-semibold">{transition.service}</h3>
            <p className="text-sm text-muted-foreground">
              {transition.customer} · currently {transition.status}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {(() => {
                const flow = ["Quoted", "Scheduled", "In Progress", "Completed"];
                const idx = flow.indexOf(transition.status);
                const next = idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;
                return (
                  <>
                    {next && (
                      <Button
                        disabled={acting}
                        onClick={async () => {
                          setActing(true);
                          try {
                            await setJobStatus(transition.id, next);
                            refresh();
                            setTransition(null);
                          } finally {
                            setActing(false);
                          }
                        }}
                      >
                        {acting
                          ? "Saving…"
                          : next === "In Progress"
                            ? "Start job"
                            : next === "Completed"
                              ? "Complete job"
                              : `Move to ${next}`}
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setTransition(null)}>
                      Close
                    </Button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// TrailPanel is used for the "My trail" nav entry and is defined in this
// module (it is not re-exported by @/lib/beacon — that module only exports
// the useBeacon hook). The panel renders the GPS beacon with an offline
// outbox that drains on reconnect.
const TrailPanel = () => {
  const { session } = useSession();
  const beacon = useBeacon(session?.id ?? null);
  const statusCopy: Record<string, string> = {
    idle: "Beacon off",
    acquiring: "Acquiring GPS fix…",
    live: "Broadcasting position",
    denied: "Location permission denied",
    unsupported: "This device has no geolocation",
    error: "Location error",
  };
  const live = beacon.status === "live";

  return (
    <section className="panel jobs-panel">
      <div className="panel-head">
        <div>
          <h2>My trail beacon</h2>
          <p>
            {beacon.deviceLabel
              ? `Device · ${beacon.deviceLabel}`
              : beacon.deviceId
                ? "Registered device found"
                : "No registered device — ask an admin to add one on the Devices page"}
          </p>
        </div>
        <span
          className={`status ${live ? "status-in-progress" : "status-scheduled"}`}
          style={{ textTransform: "none" }}
        >
          <span />
          {statusCopy[beacon.status] ?? beacon.status}
        </span>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        <section className="panel" style={{ gap: 12 }}>
          <div className="flex flex-wrap items-center gap-3">
            {live ? (
              <Button variant="outline" onClick={beacon.stop}>
                Stop beacon
              </Button>
            ) : (
              <Button onClick={beacon.start} disabled={!session || beacon.status === "acquiring"}>
                Start beacon
              </Button>
            )}
            {beacon.queued > 0 && (
              <Button variant="ghost" onClick={() => void beacon.drain()}>
                Retry {beacon.queued} queued ping{beacon.queued === 1 ? "" : "s"}
              </Button>
            )}
          </div>

          {beacon.error && <p className="text-sm text-destructive">{beacon.error}</p>}

          <div className="detail-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
            <div className="detail-block">
              <span>LATITUDE</span>
              <strong>{beacon.fix ? beacon.fix.lat.toFixed(5) : "—"}</strong>
            </div>
            <div className="detail-block">
              <span>LONGITUDE</span>
              <strong>{beacon.fix ? beacon.fix.lng.toFixed(5) : "—"}</strong>
            </div>
            <div className="detail-block">
              <span>ACCURACY</span>
              <strong>{beacon.fix?.accuracy ? `${Math.round(beacon.fix.accuracy)} m` : "—"}</strong>
            </div>
            <div className="detail-block">
              <span>LAST FIX</span>
              <strong>{beacon.fix ? new Date(beacon.fix.at).toLocaleTimeString() : "—"}</strong>
            </div>
            <div className="detail-block">
              <span>PINGS SENT</span>
              <strong>{beacon.sent}</strong>
            </div>
            <div className="detail-block">
              <span>QUEUED OFFLINE</span>
              <strong>{beacon.queued}</strong>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Pings land in the admin live map and geofence log — the trail replays day by day. Keep
            this page open while on shift; queued pings send automatically when coverage returns.
          </p>
        </section>
      </div>
    </section>
  );
};
