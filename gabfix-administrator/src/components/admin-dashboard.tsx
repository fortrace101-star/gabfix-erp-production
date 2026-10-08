import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  Moon,
  Sun,
  Boxes,
  BriefcaseBusiness,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Command,
  Ellipsis,
  Gauge,
  HardHat,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Radio,
  PackageCheck,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wifi,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";


import { Button } from "@/components/ui/button";
import { ScopeBell } from "@/components/ScopeBell";
import { apiClient, type StaffSession } from "@/lib/api";
import { useWorkspaceMetrics } from "@/lib/workspace";
import { useWorkspaceData } from "@/lib/workspace-data";
import { useSession } from "@/lib/session";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const navGroups = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", icon: LayoutDashboard, active: true },
      { label: "Dispatch", icon: Gauge, navigateTo: "dispatch" },
      { label: "Finance", icon: CircleDollarSign, navigateTo: "finance" },
      { label: "Customers", icon: Users, navigateTo: "customers" },
    ],
  },    { label: "Operations",
    items: [
      { label: "Inventory", icon: Boxes, navigateTo: "inventory" },
      { label: "Assets", icon: HardHat, navigateTo: "assets" },
      { label: "Devices", icon: Radio, navigateTo: "devices" },
            { label: "Staff", icon: Users, navigateTo: "employees" },
      { label: "Permissions", icon: ShieldCheck, navigateTo: "permission-matrix" },
      { label: "Messages", icon: MessageSquareText, navigateTo: "messages" },
      { label: "Sync health", icon: Wifi, navigateTo: "sync-health" },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { label: "Request Logs", icon: Activity, navigateTo: "logs" },
      { label: "Server settings", icon: Settings, navigateTo: "settings" },
    ],
  },
];

const metrics = [
  {
    label: "Active jobs",
    value: "48",
    delta: "+8.2%",
    caption: "vs last week",
    icon: BriefcaseBusiness,
  },
  {
    label: "Revenue",
    value: "UGX 18.4M",
    delta: "+12.6%",
    caption: "this month",
    icon: CircleDollarSign,
  },
  { label: "Staff on duty", value: "26 / 31", delta: "84%", caption: "utilisation", icon: Users },
  {
    label: "SLA at risk",
    value: "06",
    delta: "2 urgent",
    caption: "needs review",
    icon: Clock3,
    warning: true,
  },
];

const chartData = [
  { day: "Mon", completed: 22, scheduled: 30 },
  { day: "Tue", completed: 29, scheduled: 33 },
  { day: "Wed", completed: 24, scheduled: 36 },
  { day: "Thu", completed: 38, scheduled: 42 },
  { day: "Fri", completed: 35, scheduled: 47 },
  { day: "Sat", completed: 44, scheduled: 49 },
  { day: "Sun", completed: 41, scheduled: 46 },
];

const jobs = [
  {
    id: "JOB-0146",
    client: "Arcadia Residences",
    service: "Window graphics",
    team: "M. Okello +2",
    due: "Today, 14:30",
    status: "In progress",
    tone: "info",
  },
  {
    id: "JOB-0145",
    client: "Kampala Design Hub",
    service: "Exterior signage",
    team: "D. Achieng +3",
    due: "Today, 16:00",
    status: "SLA risk",
    tone: "danger",
  },
  {
    id: "JOB-0142",
    client: "Nakasero Medical",
    service: "Reception branding",
    team: "J. Kato +1",
    due: "Tomorrow",
    status: "Scheduled",
    tone: "neutral",
  },
  {
    id: "JOB-0139",
    client: "The Pearl Hotel",
    service: "Wayfinding system",
    team: "S. Namusoke +4",
    due: "28 Sep",
    status: "Review",
    tone: "warning",
  },
  {
    id: "JOB-0137",
    client: "Brew District",
    service: "Menu boards",
    team: "P. Ssekandi +1",
    due: "29 Sep",
    status: "Ready",
    tone: "success",
  },
];

const activities = [
  {
    title: "Payment reconciled",
    meta: "INV-0098 · UGX 2.4M",
    time: "4 min",
    icon: CircleDollarSign,
  },
  { title: "Job reassigned", meta: "JOB-0145 · to David's team", time: "18 min", icon: Users },
  {
    title: "Stock threshold reached",
    meta: "Gold vinyl · 4 rolls left",
    time: "42 min",
    icon: PackageCheck,
  },
  { title: "Device came online", meta: "Laundry FO · TAB-03", time: "1 hr", icon: Wifi },
];

const crew = [
  { initials: "MO", name: "Moses Okello", task: "Ntinda · 3 stops", progress: 72 },
  { initials: "DA", name: "Diana Achieng", task: "Kololo · 2 stops", progress: 48 },
  { initials: "JK", name: "John Kato", task: "Nakasero · 1 stop", progress: 86 },
];

function StatusBadge({ tone, children }: { tone: string; children: string }) {
  return (
    <span className={cn("status-badge", `status-${tone}`)}>
      <span className="status-dot" />
      {children}
    </span>
  );
}

export function AdminDashboard({
  onNavigate,
}: {
  onNavigate?: (page: string) => void;
}) {
  const live = useWorkspaceMetrics();
  const { data: workspace } = useWorkspaceData();
  const session = useSession();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    apiClient.auth.me().then((user) => {
      if (alive) setSession(user);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [range, setRange] = useState("7 days");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  // Theme toggle (gap item 8): class-on-<html> dark mode with persistence.
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("gabfix-admin:theme") === "dark";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("gabfix-admin:theme", dark ? "dark" : "light");
    } catch {
      /* private mode: theme just doesn't persist */
    }
  }, [dark]);

  // Live jobs (A6): the console table reads real rows when the API is
  // configured, and falls back to the demo board so the shell still demos.
  const liveJobs = useMemo(() => {
    if (!workspace) return null;
    const toneFor = (status: string): string =>
      status === "In Progress"
        ? "info"
        : status === "Completed"
          ? "success"
          : status === "Quoted"
            ? "warning"
            : status === "Cancelled"
              ? "danger"
              : "neutral";
    return workspace.jobs.slice(0, 8).map((job) => ({
      id: job.number,
      client: workspace.customers.find((c) => c.id === job.customerId)?.name ?? "—",
      service: workspace.services.find((s) => s.id === job.serviceId)?.name ?? "—",
      team: job.assignees.join(", ") || "unassigned",
      due: job.date,
      status: job.status,
      tone: toneFor(job.status),
    }));
  }, [workspace]);

  const filteredJobs = useMemo(() => {
    const source = liveJobs ?? jobs;
    const term = query.trim().toLowerCase();
    if (!term) return source;
    return source.filter((job) =>
      Object.values(job).some((value) => value.toLowerCase().includes(term)),
    );
  }, [liveJobs, query]);

  function toggleSelected(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width,transform] duration-300",
          collapsed ? "w-20" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-17 items-center border-b border-sidebar-border px-4">
          <img src="/gabfix-logo.png" alt="Gabfix" className="size-10 shrink-0 object-contain" />
          {!collapsed && (
            <div className="ml-3 min-w-0">
              <div className="text-base font-semibold text-sidebar-foreground">Gabfix</div>
              <div className="text-[10px] font-semibold uppercase text-sidebar-muted">
                Admin console
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            className="ml-auto lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-6">
              {!collapsed && (
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase text-sidebar-muted">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => (
                  <button
                    key={item.label}
                    title={collapsed ? item.label : undefined}
                    onClick={() =>
                      item.navigateTo && onNavigate?.(item.navigateTo)
                    }
                    className={cn(
                      "group flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm transition-colors",
                      item.active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <item.icon
                      className={cn("size-[18px] shrink-0", item.active && "text-primary")}
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left font-medium">{item.label}</span>
                        {item.count && (
                          <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {item.count}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button className="flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
            <Settings className="size-[18px]" />
            {!collapsed && <span>Settings</span>}
          </button>
          <button
            className="mt-2 hidden h-9 w-full items-center justify-center rounded-md text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground lg:flex"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <>
                <ChevronLeft className="mr-2 size-4" />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div className={cn("transition-[margin] duration-300", collapsed ? "lg:ml-20" : "lg:ml-64")}>
        <header className="sticky top-0 z-20 flex h-17 items-center border-b border-border bg-background/92 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open navigation"
            className="mr-2 lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </Button>
          <div className="relative hidden w-full max-w-sm sm:block">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Search console"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search jobs, staff, invoices…"
              className="h-9 w-full rounded-md border border-input bg-secondary pl-9 pr-16 text-sm outline-hidden transition focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
            <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <Command className="size-2.5" />K
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="mr-2 hidden items-center gap-2 text-xs text-muted-foreground md:flex">
              <span className="size-2 rounded-full bg-success shadow-status" />
              All systems operational
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setDark((value) => !value)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <ScopeBell
              scope="admin"
              tokenKey="gabfix-admin:auth-token"
              title="Notifications"
              emptyText="You're all caught up — new events appear here live."
            />
            <div className="mx-1 h-6 w-px bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-10 px-2">
                  <span className="flex size-7 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
                    GA
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-xs font-semibold">{session?.name ?? "—"}</span>
                    <span className="block text-[10px] text-muted-foreground">{session?.role ?? "Administrator"}</span>
                  </span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Account settings</DropdownMenuItem>
                                <DropdownMenuItem
                  onClick={() => {
                    localStorage.removeItem('gabfix-admin:auth-token');
                    localStorage.removeItem('gabfix-admin:refresh-token');
                    void apiClient.auth.signOut();
                    window.location.assign('/auth');
                  }}
                >
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 text-xs font-medium text-primary">Monday, 28 September</p>
              <h1 className="text-2xl font-semibold sm:text-[28px]">Good afternoon, Grace</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Here’s what’s happening across Gabfix today, {session?.name ?? "friend"}.
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <span className="text-base leading-none">+</span> Quick action{" "}
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Create job</DropdownMenuItem>
                <DropdownMenuItem>Record payment</DropdownMenuItem>
                <DropdownMenuItem>Add expense</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <section
            aria-label="Key metrics"
            className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4"
          >
            {metrics
              .map((metric) =>
                metric.label === "Revenue" && live.revenue !== null
                  ? { ...metric, value: live.revenue }
                  : metric.label === "Active jobs" && live.activeJobs !== null
                    ? { ...metric, value: String(live.activeJobs) }
                    : metric,
              )
              .map((metric) => (
              <div key={metric.label} className="bg-card p-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
                  <metric.icon className="size-4 text-muted-foreground" />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <strong className="text-2xl font-semibold">{metric.value}</strong>
                  <span
                    className={cn(
                      "mb-0.5 text-[11px] font-semibold",
                      metric.warning ? "text-destructive" : "text-success",
                    )}
                  >
                    {metric.delta}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{metric.caption}</p>
              </div>
            ))}
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.7fr)]">
            <section className="panel min-w-0">
              <div className="panel-header flex-wrap gap-3">
                <div>
                  <h2 className="panel-title">Weekly throughput</h2>
                  <p className="panel-subtitle">Scheduled and completed jobs</p>
                </div>
                <div className="segmented-control">
                  {["7 days", "30 days", "Quarter"].map((item) => (
                    <button
                      key={item}
                      onClick={() => setRange(item)}
                      className={range === item ? "is-active" : ""}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-72 px-2 pb-3 pt-5 sm:px-5">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <defs>
                      <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-gold)" stopOpacity={0.24} />
                        <stop offset="100%" stopColor="var(--chart-gold)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--chart-grid)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="day"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="scheduled"
                      stroke="var(--chart-muted)"
                      strokeWidth={1.5}
                      fill="transparent"
                    />
                    <Area
                      type="monotone"
                      dataKey="completed"
                      stroke="var(--chart-gold)"
                      strokeWidth={2}
                      fill="url(#goldArea)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-5 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-2">
                  <span className="h-px w-5 bg-primary" />
                  Completed
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-px w-5 bg-chart-muted" />
                  Scheduled
                </span>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Field operations</h2>
                  <p className="panel-subtitle">Live crew progress</p>
                </div>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase text-success">
                  <Activity className="size-3" /> Live
                </span>
              </div>
              <div className="divide-y divide-border">
                {crew.map((person) => (
                  <div key={person.name} className="p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 items-center justify-center rounded-md bg-secondary text-[10px] font-bold text-secondary-foreground">
                        {person.initials}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2">
                          <p className="truncate text-xs font-semibold">{person.name}</p>
                          <span className="text-[10px] text-muted-foreground">
                            {person.progress}%
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {person.task}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${person.progress}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border p-3">
                <Button variant="ghost" className="w-full text-xs text-muted-foreground">
                  Open dispatch board <ChevronRight className="size-3" />
                </Button>
              </div>
            </section>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.7fr)]">
            <section className="panel min-w-0 overflow-hidden">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Current jobs</h2>
                  <p className="panel-subtitle">
                    {selected.length ? `${selected.length} selected` : "Priority work in progress"}
                  </p>
                </div>
                <Button variant="ghost" size="sm">
                  View all <ChevronRight className="size-3" />
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-y border-border bg-secondary/50 text-[10px] uppercase text-muted-foreground">
                      <th className="w-12 px-4 py-2.5">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="px-2 py-2.5 font-semibold">Job</th>
                      <th className="px-2 py-2.5 font-semibold">Service</th>
                      <th className="px-2 py-2.5 font-semibold">Team</th>
                      <th className="px-2 py-2.5 font-semibold">Due</th>
                      <th className="px-2 py-2.5 font-semibold">Status</th>
                      <th className="w-12 px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredJobs.map((job) => (
                      <tr
                        key={job.id}
                        className={cn(
                          "text-xs transition-colors hover:bg-secondary/40",
                          selected.includes(job.id) && "bg-primary/5",
                        )}
                      >
                        <td className="px-4 py-3.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${job.id}`}
                            checked={selected.includes(job.id)}
                            onChange={() => toggleSelected(job.id)}
                            className="size-3.5 accent-primary"
                          />
                        </td>
                        <td className="px-2 py-3.5">
                          <p className="font-semibold text-primary">{job.id}</p>
                          <p className="mt-1 text-[11px] text-muted-foreground">{job.client}</p>
                        </td>
                        <td className="px-2 py-3.5">{job.service}</td>
                        <td className="px-2 py-3.5 text-muted-foreground">{job.team}</td>
                        <td className="px-2 py-3.5 text-muted-foreground">{job.due}</td>
                        <td className="px-2 py-3.5">
                          <StatusBadge tone={job.tone}>{job.status}</StatusBadge>
                        </td>
                        <td className="px-4 py-3.5">
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${job.id}`}>
                            <Ellipsis />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredJobs.length && (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No jobs match “{query}”.
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">Recent activity</h2>
                  <p className="panel-subtitle">Across all systems</p>
                </div>
                <ShieldCheck className="size-4 text-muted-foreground" />
              </div>
              <div className="divide-y divide-border">
                {activities.map((item) => (
                  <div key={item.title} className="flex gap-3 p-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                      <item.icon className="size-3.5 text-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold">{item.title}</p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.meta}</p>
                    </div>
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      {item.time}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
