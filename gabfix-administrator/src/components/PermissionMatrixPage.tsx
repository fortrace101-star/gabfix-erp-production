import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, ShieldCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { useDocumentTitle } from "@/lib/use-document-title";

type CapabilityRow = {
  assign_crew: boolean;
  view_reports: boolean;
  manage_employees: boolean;
  manage_access: boolean;
};

type UserRow = {
  id: string;
  name: string;
  role: string;
  active: boolean;
};

const ROLES = [
  "owner",
  "manager",
  "sales",
  "technician",
  "laundry",
  "accountant",
  "storekeeper",
  "csr",
] as const;

const CAPABILITIES = [
  { id: "assign_crew", label: "Assign crew", icon: Users },
  { id: "view_reports", label: "View reports", icon: ShieldCheck },
  { id: "manage_employees", label: "Manage employees", icon: Users },
  { id: "manage_access", label: "Manage access", icon: ShieldCheck },
  { id: "handle_leads", label: "Handle leads", icon: Users },
  { id: "review_feedback", label: "Review feedback", icon: ShieldCheck },
] as const;

/** Role -> capability map (source of truth, mirrors server CAPABILITY_ROLES). */
const ROLE_MATRIX = {
  owner: {
    assign_crew: true,
    view_reports: true,
    manage_employees: true,
    manage_access: true,
    handle_leads: true,
    review_feedback: true,
  },
  manager: {
    assign_crew: true,
    view_reports: true,
    manage_employees: true,
    manage_access: true,
    handle_leads: true,
    review_feedback: true,
  },
  sales: {
    assign_crew: false,
    view_reports: true,
    manage_employees: false,
    manage_access: false,
    handle_leads: true,
    review_feedback: false,
  },
  csr: {
    assign_crew: true,
    view_reports: true,
    manage_employees: false,
    manage_access: false,
    handle_leads: true,
    review_feedback: true,
  },
  technician: {
    assign_crew: true,
    view_reports: false,
    manage_employees: false,
    manage_access: false,
    handle_leads: false,
    review_feedback: false,
  },
  laundry: {
    assign_crew: true,
    view_reports: false,
    manage_employees: false,
    manage_access: false,
    handle_leads: false,
    review_feedback: false,
  },
  accountant: {
    assign_crew: true,
    view_reports: false,
    manage_employees: false,
    manage_access: false,
    handle_leads: false,
    review_feedback: false,
  },
  storekeeper: {
    assign_crew: true,
    view_reports: false,
    manage_employees: false,
    manage_access: false,
    handle_leads: false,
    review_feedback: false,
  },
} as const;

const roleTone: Record<string, string> = {
  owner: "text-primary",
  manager: "text-foreground",
};

export function PermissionMatrixPage({ onBack }: { onBack?: () => void }) {
  useDocumentTitle(
    "Permission matrix — Gabfix Admin Console",
    "Who can do what, and which apps they reach.",
  );
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await apiClient.get<UserRow[]>("/employees");
      setUsers(rows);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 flex h-17 items-center justify-between border-b border-border bg-background/92 px-4 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
              <X />
            </Button>
          )}
          <div>
            <h1 className="text-lg font-semibold">Permission matrix</h1>
            <p className="text-xs text-muted-foreground">
              Roles and per-user capability grants
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {error && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        )}
        <section className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          {/* ── Role → capability map ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="size-4" /> Role → capability
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Source of truth for the server's role checks. Changes here are
              reflected globally once a user logs in again.
            </p>
            <div className="space-y-2 text-sm">
              {ROLES.map((role) => (
                <div
                  key={role}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                    role === "owner" ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <span className={`text-xs font-semibold ${roleTone[role] ?? ""}`}>
                    {role}
                  </span>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {CAPABILITIES.map(({ id, label }) => (
                      <div
                        key={id}
                        className={`rounded-md px-2 py-1 ${
                          ROLE_MATRIX[role][id]
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-600"
                        }`}
                      >
                        {ROLE_MATRIX[role][id] ? (
                          <><span className="font-semibold">✓</span> {label}</>
                        ) : (
                          <><span className="font-semibold">✗</span> {label}</>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Per-user grants ── */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4" /> Per-user grants
            </h2>
            {!users && !error && (
              <div className="flex min-h-[20vh] items-center justify-center">
                <LoaderCircle className="size-7 animate-spin text-muted-foreground" />
              </div>
            )}
            {users && (
              <ul className="space-y-3">
                {users.map((u) => {
                  const grants = {
                    assign_crew: ROLE_MATRIX[u.role].assign_crew,
                    view_reports: ROLE_MATRIX[u.role].view_reports,
                    manage_employees: ROLE_MATRIX[u.role].manage_employees,
                    manage_access: ROLE_MATRIX[u.role].manage_access,
                    handle_leads: ROLE_MATRIX[u.role].handle_leads,
                    review_feedback: ROLE_MATRIX[u.role].review_feedback,
                  };
                  return (
                    <li key={u.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold ${roleTone[u.role] ?? ""}`}>
                            {u.role}
                          </span>
                          <span className="text-xs text-muted-foreground">{u.name}</span>
                        </div>
                        {u.active ? (
                          <span className="text-xs text-emerald-600">active</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">inactive</span>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {CAPABILITIES.map(({ id, label }) => (
                          <div
                            key={id}
                            className={`rounded-md px-2 py-1.5 text-xs ${
                              grants[id]
                                ? "bg-primary text-primary-foreground"
                                : "bg-secondary text-muted-foreground"
                            }`}
                          >
                            {label}
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ── Assignment guidance ── */}
        <section className="mt-6 rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">
            Assignment capability
          </h2>
          <p className="text-xs text-muted-foreground">
            Only roles listed as <code className="text-[10px] font-mono">assign_crew</code> can assign crew
            on the dispatch board. Server-side, this is checked in
            <code className="text-[10px] font-mono"> /api/jobs/:id/assignments</code>. Roles without it
            cannot give assignment roles to anyone.
          </p>
        </section>
      </main>
    </div>
  );
}
