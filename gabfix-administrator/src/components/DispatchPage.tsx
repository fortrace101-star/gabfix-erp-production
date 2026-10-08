import { useCallback, useEffect, useState } from "react";
import { Plus, Users, X, Loader2 } from "lucide-react";
import { AdminModal, AdminPage, adminFieldLabel, adminInputClass } from "@/components/AdminPage";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

import { apiClient } from "@/lib/api";
import { useWorkspaceData, useWorkspaceSse } from "@/lib/workspace-data";

const money = (v: number) => `UGX ${Math.round(v).toLocaleString("en-UG")}`;
const today = () => new Date().toISOString().slice(0, 10);

type Assignee = { id: string; name: string; role: string };

export function DispatchPage({ onBack }: { onBack?: () => void }) {
  const { data, error, refresh } = useWorkspaceData();
  useWorkspaceSse(onBoardChanged);

  // --- "New job" modal (POST /api/jobs) ---
  const [modal, setModal] = useState<"job-create" | null>(null);
  const [newJobSaving, setNewJobSaving] = useState(false);
  const [newJobError, setNewJobError] = useState("");
  const [newJobForm, setNewJobForm] = useState<{
    customerId: string;
    serviceId: string;
    date: string;
    revenue: string;
  }>({ customerId: "", serviceId: "", date: today(), revenue: "" });

  // --- Job assignments (assignments.ts read endpoints) ---
  const [assignments, setAssignments] = useState<Record<string, Assignee[]>>({});
  const [assignable, setAssignable] = useState<Assignee[]>([]);
  const [assignModal, setAssignModal] = useState<{ jobId: string | null; open: boolean }>({
    jobId: null,
    open: false,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [removedJob, setRemovedJob] = useState<string | null>(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignRole, setAssignRole] = useState("technician");

  // Load the assignable staff list once on mount so crew pickers have data.
  const loadAssignable = useCallback(async () => {
    try {
      const rows = await apiClient.get<Assignee[]>("/employees/assignable");
      setAssignable(rows);
    } catch {
      // name-only list, never blocks the board
    }
  }, []);

  const loadAssignments = useCallback(async (jobId: string) => {
    try {
      const rows = await apiClient.get<{ employeeId: string; name: string; role: string }[]>(
        `/jobs/${jobId}/assignments`,
      );
      setAssignments((prev) => ({
        ...prev,
        [jobId]: rows.map((a) => ({ ...a, id: a.employeeId })),
      }));
    } catch {
      // non-fatal
    }
  }, []);

  // Load assignable staff and existing assignments for all current jobs on mount.
  useEffect(() => {
    loadAssignable();
    void data?.jobs.forEach((job) => {
      void loadAssignments(job.id);
    });
  }, [loadAssignable, loadAssignments, data?.jobs]);

  async function onBoardChanged() {
    await refresh();
    loadAssignable();
    void data?.jobs.forEach((job) => {
      void loadAssignments(job.id);
    });
    if (assignModal.jobId) await loadAssignments(assignModal.jobId);
  }

  async function createJob(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNewJobSaving(true);
    setNewJobError("");
    try {
      await apiClient.request("/jobs", {
        method: "POST",
        body: JSON.stringify({
          customerId: newJobForm.customerId,
          serviceId: newJobForm.serviceId,
          date: newJobForm.date,
          revenue: Number(newJobForm.revenue) || 0,
        }),
      });
      setModal(null);
      setNewJobForm({ customerId: "", serviceId: "", date: today(), revenue: "" });
      refresh();
    } catch (err) {
      setNewJobError(err instanceof Error ? err.message : "Could not create job");
    } finally {
      setNewJobSaving(false);
    }
  }

  async function assign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const jobId = assignModal.jobId;
    if (!jobId || !assignEmployeeId) return;
    setSaving(true);
    setFormError("");
    try {
      await apiClient.request(`/jobs/${jobId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ employeeId: assignEmployeeId, role: assignRole }),
      });
      setAssignModal({ jobId: null, open: false });
      setAssignEmployeeId("");
      setAssignRole("technician");
      await loadAssignments(jobId);
      await loadAssignable();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not assign employee");
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment(jobId: string, employeeId: string) {
    setRemovedJob(jobId);
    try {
      await apiClient.request(`/jobs/${jobId}/assignments/${employeeId}`, { method: "DELETE" });
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
      await loadAssignments(jobId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not remove assignment");
    } finally {
      setRemovedJob(null);
    }
  }

  return (
    <AdminPage
      title="Dispatch board"
      subtitle="Assign tasks to crew · track everything live"
      onBack={onBack}
      loading={!data}
      error={error}
      actions={
                <Button size="sm" onClick={() => setModal("job-create")}>
          <Plus /> New job
        </Button>
      }
    >
      <div className="space-y-3">
        {(data?.jobs ?? []).map((job) => {
          const customer = data?.customers.find((c) => c.id === job.customerId)?.name ?? "—";
          const service = data?.services.find((s) => s.id === job.serviceId)?.name ?? "—";
          const current = assignments[job.id] ?? [];
          return (
            <div
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {job.number} · {service}
                </p>
                <p className="text-xs text-muted-foreground">
                  {customer} · {job.date} ·{" "}
                  {current.length ? (
                    <span className="font-medium text-foreground">
                      {current.map((a) => a.name).join(", ")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">unassigned</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{money(job.revenue)}</span>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    job.status === "Scheduled"
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : job.status === "In Progress"
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : job.status === "Completed"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                          : "border-border text-muted-foreground"
                  }`}
                >
                  {job.status}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Assign crew to ${job.number}`}
                  onClick={() => setAssignModal({ jobId: job.id, open: true })}
                >
                  <Users /> Assign
                </Button>
              </div>
            </div>
          );
        })}
        {data && data.jobs.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No jobs yet — create the first one.
          </p>
        )}
      </div>

            
      {/* New job creation modal (POST /api/jobs) */}
      <AdminModal
        open={modal === "job-create"}
        title="New job"
        description="Creates a job and assigns it a tracking number. Pick a customer and service below."
        onClose={() => {
          setModal(null);
          setNewJobForm({ customerId: "", serviceId: "", date: today(), revenue: "" });
          setNewJobError("");
        }}
      >
        <form onSubmit={createJob} className="space-y-4">
          <label className="block space-y-2">
            <span className={adminFieldLabel}>Customer</span>
            <Select
              value={newJobForm.customerId}
              onValueChange={(v) => setNewJobForm((p) => ({ ...p, customerId: v }))}
            >
              <SelectTrigger className={adminInputClass}>
                <SelectValue placeholder="Choose a customer…" />
              </SelectTrigger>
              <SelectContent>
                {(data?.customers ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-2">
            <span className={adminFieldLabel}>Service</span>
            <Select
              value={newJobForm.serviceId}
              onValueChange={(v) => setNewJobForm((p) => ({ ...p, serviceId: v }))}
            >
              <SelectTrigger className={adminInputClass}>
                <SelectValue placeholder="Choose a service…" />
              </SelectTrigger>
              <SelectContent>
                {(data?.services ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
                    <label className="block space-y-2">
            <span className={adminFieldLabel}>Date</span>
            <Input
              type="date"
              required
              className={adminInputClass}
              value={newJobForm.date}
              onChange={(e) => setNewJobForm((p) => ({ ...p, date: e.target.value }))}
            />
          </label>
          <label className="block space-y-2">
            <span className={adminFieldLabel}>Revenue</span>
            <Input
              type="number"
              min="0"
              step="1000"
              placeholder="UGX 0"
              required
              className={adminInputClass}
              value={newJobForm.revenue}
              onChange={(e) => setNewJobForm((p) => ({ ...p, revenue: e.target.value }))}
            />
          </label>
          {newJobError && <p className="text-sm text-destructive">{newJobError}</p>}
          <Button
            className="w-full"
            disabled={!newJobForm.customerId || !newJobForm.serviceId || newJobSaving}
          >
            {newJobSaving ? <Loader2 className="size-4 animate-spin" /> : null}
            {newJobSaving ? "Creating…" : "Create job"}
          </Button>
        </form>
      </AdminModal>

      <AdminModal
        open={assignModal.open}
        title={`Assign to ${assignModal.jobId ? (data?.jobs.find((j) => j.id === assignModal.jobId)?.number ?? "job") : ""}`}
        description={assignModal.jobId ? undefined : "Create a job and then assign crew to it."}
        onClose={() => {
          setAssignModal({ jobId: null, open: false });
          setAssignEmployeeId("");
          setAssignRole("technician");
        }}
      >
        {!assignModal.jobId ? (
          <p className="py-2 text-sm text-muted-foreground">
            Select a job above, then open Assign again.
          </p>
        ) : (
          <form onSubmit={assign} className="space-y-4">
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Crew member</span>
              <Select value={assignEmployeeId} onValueChange={setAssignEmployeeId}>
                <SelectTrigger className={adminInputClass} aria-label="Crew member">
                  <SelectValue placeholder="Choose an employee…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__placeholder__" disabled>
                    Choose an employee…
                  </SelectItem>
                  {assignable.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{" "}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {a.role}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                Or pick an employee from the list above.
              </span>
            </label>
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Role</span>
              <Select value={assignRole} onValueChange={setAssignRole}>
                <SelectTrigger className={adminInputClass} aria-label="Role">
                  <SelectValue placeholder="Technician" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="technician">Technician</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="assistant">Assistant</SelectItem>
                  <SelectItem value="salesperson">Salesperson</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <Button className="w-full" disabled={!assignEmployeeId || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {saving ? "Assigning…" : "Assign to job"}
            </Button>
          </form>
        )}
      </AdminModal>

      {/* Inline crew roster per job */}
      {(data?.jobs ?? []).map((job) => {
        const current = assignments[job.id] ?? [];
        if (current.length === 0) return null;
        return (
          <div
            key={`roster-${job.id}`}
            className="rounded-xl border border-border bg-muted/5 px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Crew</p>
              {removedJob === job.id && (
                <p className="text-xs text-emerald-600">
                  Removed {assignments[job.id]?.[0]?.name ?? ""}
                </p>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeAssignment(job.id, assignments[job.id]?.[0]?.id ?? "")}
                aria-label={`Remove ${assignments[job.id]?.[0]?.name ?? ""}`}
              >
                <X className="size-3" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {current.map((a) => (
                <span
                  key={a.id}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium"
                >
                  {a.name}
                  <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                    {a.role}
                  </span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </AdminPage>
  );
}
