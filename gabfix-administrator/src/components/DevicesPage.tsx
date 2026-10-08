import { useEffect, useState, type FormEvent } from "react";
import { Plus, Radio } from "lucide-react";
import { AdminModal, AdminPage, adminFieldLabel, adminInputClass } from "@/components/AdminPage";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { useWorkspaceData, useWorkspaceSse } from "@/lib/workspace-data";

type DeviceRow = {
  id: string;
  msisdn: string;
  label: string;
  type: string;
  active: boolean;
  employeeId: string | null;
  employeeName: string | null;
  installedAt: string | null;
  createdAt: string;
};

/**
 * Devices registry (gap-list item 2): msisdn ↔ employee mapping that the
 * portal beacon and the live map resolve against. Register, reassign, and
 * deactivate without touching the database.
 */
export function DevicesPage({ onBack }: { onBack?: () => void }) {
  const { data, error } = useWorkspaceData();
  useWorkspaceSse(() => undefined);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState<"create" | { editId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const rows = await apiClient.get<DeviceRow[]>("/devices");
      setDevices(rows);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load devices");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const editing = modal && modal !== "create" ? devices.find((d) => d.id === modal.editId) : null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setFormError("");
    const employeeId = String(fd.get("employeeId") || "");
    const body = editing
      ? {
          label: String(fd.get("label") || ""),
          employeeId: employeeId || null,
          active: fd.get("active") === "on",
        }
      : {
          msisdn: String(fd.get("msisdn")),
          label: String(fd.get("label") || ""),
          type: String(fd.get("type") || "phone"),
          employeeId: employeeId || null,
        };
    try {
      await apiClient.request(editing ? `/devices/${editing.id}` : "/devices", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      setModal(null);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(device: DeviceRow) {
    setSaving(true);
    try {
      await apiClient.request(`/devices/${device.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !device.active }),
      });
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPage
      title="Devices"
      subtitle="Company phones and trackers issued to field staff — the beacon registry"
      onBack={onBack}
      loading={loading || !data}
      error={error || loadError}
      actions={
        <Button size="sm" onClick={() => setModal("create")}>
          <Plus /> Register device
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">MSISDN</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Holder</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs font-bold">{d.msisdn}</td>
                <td className="px-4 py-3">{d.label || "—"}</td>
                <td className="px-4 py-3">{d.type}</td>
                <td className="px-4 py-3">{d.employeeName || <span className="text-muted-foreground">unassigned</span>}</td>
                <td className="px-4 py-3">
                  <span className={d.active ? "text-success" : "text-muted-foreground"}>
                    {d.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(d)} disabled={saving}>
                      {d.active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setModal({ editId: d.id })}>
                      Edit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {devices.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  <Radio className="mx-auto mb-2 size-6 text-muted-foreground" />
                  No devices registered yet — add the first phone or tracker.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AdminModal
        open={Boolean(modal)}
        title={editing ? `Edit ${editing.msisdn}` : "Register device"}
        description={editing ? "Reassign the holder or rename the device." : "The msisdn is what the beacon identifies itself with."}
        onClose={() => setModal(null)}
      >
        <form onSubmit={submit} className="space-y-4">
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-2">
                <span className={adminFieldLabel}>MSISDN</span>
                <input name="msisdn" required className={adminInputClass} placeholder="+25677…" />
              </label>
              <label className="block space-y-2">
                <span className={adminFieldLabel}>Type</span>
                <select name="type" className={adminInputClass}>
                  <option value="phone">Phone</option>
                  <option value="tracker">Tracker</option>
                </select>
              </label>
            </div>
          )}
          <label className="block space-y-2">
            <span className={adminFieldLabel}>Label</span>
            <input name="label" defaultValue={editing?.label ?? ""} className={adminInputClass} placeholder="TAB-03, van tracker…" />
          </label>
          <label className="block space-y-2">
            <span className={adminFieldLabel}>Assigned to</span>
            <EmployeeSelect name="employeeId" defaultValue={editing?.employeeId ?? ""} />
          </label>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input name="active" type="checkbox" defaultChecked={editing.active} className="size-4 accent-primary" />
              Active — beacon may report
            </label>
          )}
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button className="w-full" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Register device"}
          </Button>
        </form>
      </AdminModal>
    </AdminPage>
  );
}

/** Staff picker backed by GET /api/employees (control plane). */
function EmployeeSelect({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; role: string }>>([]);
  useEffect(() => {
    apiClient
      .get<Array<{ id: string; name: string; role: string }>>("/employees")
      .then(setEmployees)
      .catch(() => setEmployees([]));
  }, []);
  return (
    <select name={name} defaultValue={defaultValue} className={adminInputClass}>
      <option value="">— unassigned —</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name} ({e.role})
        </option>
      ))}
    </select>
  );
}
