import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Plus, ShieldCheck, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";
import { useDocumentTitle } from "@/lib/use-document-title";
import { InviteCodeList } from "@/components/InviteCodeList";
import { StaffAccessModal } from "@/components/StaffAccessModal";

type Employee = {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  hourlyRate: number;
  appScope: string[];
  active: boolean;
};

const SCOPES = ["admin", "laundry", "portal", "store"] as const;
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

const roleTone: Record<string, string> = {
  owner: "text-primary",
  manager: "text-foreground",
};

export function EmployeesPage({ onBack }: { onBack?: () => void }) {
  useDocumentTitle(
    "Staff & access — Gabfix Admin Console",
    "Create staff accounts, grant app scopes, and manage activation.",
  );
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // New-employee form state
  const [form, setForm] = useState({
    name: "",
    role: "technician",
    phone: "",
    password: "",
    scopes: ["portal"] as string[],
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await apiClient.get<Employee[]>("/employees");
      setEmployees(rows);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load employees");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await apiClient.request(`/employees/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleScope(emp: Employee, scope: string) {
    const has = emp.appScope.includes(scope);
    const next = has ? emp.appScope.filter((s) => s !== scope) : [...emp.appScope, scope];
    await patch(emp.id, { app_scope: next });
  }

  async function createEmployee() {
    setSaving(true);
    setError("");
    try {
      await apiClient.request("/employees", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          phone: form.phone,
          app_scope: form.scopes,
          ...(form.password ? { password: form.password } : {}),
        }),
      });
      setDialogOpen(false);
      setForm({ name: "", role: "technician", phone: "", password: "", scopes: ["portal"] });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create employee");
    } finally {
      setSaving(false);
    }
  }

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
            <h1 className="text-lg font-semibold">Staff & access</h1>
            <p className="text-xs text-muted-foreground">
              Who can sign in, and which apps they reach
            </p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> New employee
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New employee</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium">Full name</span>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Grace Atim"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Role</span>
                  <Select value={form.role} onValueChange={(role) => setForm({ ...form, role })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Phone</span>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="+256 772 …"
                  />
                </label>
              </div>
              <label className="block space-y-2">
                <span className="text-sm font-medium">
                  Initial password <span className="text-muted-foreground">(optional)</span>
                </span>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Min 6 characters"
                />
              </label>
              <div>
                <span className="mb-2 block text-sm font-medium">App access</span>
                <div className="grid grid-cols-2 gap-2">
                  {SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={form.scopes.includes(scope)}
                        onCheckedChange={(checked) =>
                          setForm({
                            ...form,
                            scopes: checked
                              ? [...form.scopes, scope]
                              : form.scopes.filter((s) => s !== scope),
                          })
                        }
                      />
                      {scope}
                    </label>
                  ))}
                </div>
              </div>
              <Button
                className="w-full"
                onClick={createEmployee}
                disabled={saving || form.name.trim().length < 2}
              >
                {saving ? <LoaderCircle className="animate-spin" /> : null}
                Create employee
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Staff &amp; access</h2>
            <p className="text-sm text-muted-foreground">
              Issue single-use account creation codes here; new hires sign up with the code and get the
              exact scopes you grant.
            </p>
          </div>
          <StaffAccessModal onGenerated={() => setRefreshKey((k) => k + 1)} />
        </div>
        <InviteCodeList refreshKey={refreshKey} />
        {error && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        )}
        {!employees && !error && (
          <div className="flex min-h-[30vh] items-center justify-center">
            <LoaderCircle className="size-7 animate-spin text-muted-foreground" />
          </div>
        )}
        {employees && (
          <ul className="space-y-3">
            {employees.map((emp) => (
              <li key={emp.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <UserRound className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">
                        {emp.name}
                        {!emp.active && (
                          <span className="ml-2 text-xs font-medium text-destructive">
                            inactive
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className={roleTone[emp.role] ?? ""}>{emp.role}</span>
                        {emp.phone ? ` · ${emp.phone}` : ""}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === emp.id || emp.role === "owner"}
                    onClick={() => patch(emp.id, { active: !emp.active })}
                  >
                    {emp.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <ShieldCheck className="size-4 text-muted-foreground" />
                  {SCOPES.map((scope) => {
                    const on = emp.appScope.includes(scope);
                    return (
                      <button
                        key={scope}
                        disabled={busyId === emp.id || emp.role === "owner"}
                        onClick={() => toggleScope(emp, scope)}
                        className={
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                          (on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground hover:border-primary/50")
                        }
                        aria-pressed={on}
                      >
                        {scope}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
