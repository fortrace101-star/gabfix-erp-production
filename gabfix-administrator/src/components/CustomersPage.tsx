import { useState, type FormEvent } from "react";
import { Download, Plus } from "lucide-react";
import { AdminModal, AdminPage, adminFieldLabel, adminInputClass } from "@/components/AdminPage";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { downloadEntityPdf } from "@/lib/pdf";
import { useWorkspaceData, useWorkspaceSse } from "@/lib/workspace-data";

const money = (v: number) => `UGX ${Math.round(v).toLocaleString("en-UG")}`;

/**
 * Customer CRUD (gap-list item 7): the ledger already posts against customers —
 * this adds the missing create/edit modal and the statement PDF download.
 */
export function CustomersPage({ onBack }: { onBack?: () => void }) {
  const { data, error, refresh } = useWorkspaceData();
  useWorkspaceSse(refresh);
  const [modal, setModal] = useState<"create" | { editId: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [busyStatement, setBusyStatement] = useState<string | null>(null);

  const editing = modal && modal !== "create" ? (data?.customers ?? []).find((c) => c.id === modal.editId) : null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setFormError("");
    const body = {
      name: String(fd.get("name")),
      company: String(fd.get("company") || ""),
      type: String(fd.get("type")),
      phone: String(fd.get("phone") || ""),
      email: String(fd.get("email") || ""),
      status: String(fd.get("status") || "Active"),
    };
    try {
      if (editing) {
        await apiClient.request(`/data/customers/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await apiClient.request("/customers", { method: "POST", body: JSON.stringify({ ...body, balance: 0 }) });
      }
      setModal(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function statement(id: string) {
    setBusyStatement(id);
    downloadEntityPdf("statement", id)
      .catch((err) => setFormError(err instanceof Error ? err.message : "PDF failed"))
      .finally(() => setBusyStatement(null));
  }

  return (
    <AdminPage
      title="Customers"
      subtitle="Accounts, balances, and statements across every division"
      onBack={onBack}
      loading={!data}
      error={error}
      actions={
        <Button size="sm" onClick={() => setModal("create")}>
          <Plus /> New customer
        </Button>
      }
    >
      {formError && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{formError}</p>
      )}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.customers ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <p className="font-medium">{c.name}</p>
                  {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
                </td>
                <td className="px-4 py-3">{c.type}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  <p>{c.phone || "—"}</p>
                  {c.email && <p className="text-xs">{c.email}</p>}
                </td>
                <td className="px-4 py-3 text-right">{money(c.balance)}</td>
                <td className="px-4 py-3">{c.status}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyStatement === c.id}
                      onClick={() => statement(c.id)}
                      title="Download statement PDF"
                    >
                      <Download />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setModal({ editId: c.id })}>
                      Edit
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {(data?.customers ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No customers yet — create the first account.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AdminModal
        open={Boolean(modal)}
        title={editing ? `Edit ${editing.name}` : "New customer"}
        description={editing ? "Changes apply immediately to jobs, invoices, and statements." : "Creates the account used by jobs, invoices, and laundry intake."}
        onClose={() => setModal(null)}
      >
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-2">
            <span className={adminFieldLabel}>Name</span>
            <input name="name" required defaultValue={editing?.name ?? ""} className={adminInputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Company</span>
              <input name="company" defaultValue={editing?.company ?? ""} className={adminInputClass} />
            </label>
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Type</span>
              <select name="type" defaultValue={editing?.type ?? "Residential"} className={adminInputClass}>
                <option>Residential</option>
                <option>Commercial</option>
                <option>Corporate</option>
              </select>
            </label>
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Phone</span>
              <input name="phone" defaultValue={editing?.phone ?? ""} className={adminInputClass} placeholder="07…" />
            </label>
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Email</span>
              <input name="email" type="email" defaultValue={editing?.email ?? ""} className={adminInputClass} />
            </label>
            {editing && (
              <label className="block space-y-2 col-span-2">
                <span className={adminFieldLabel}>Status</span>
                <select name="status" defaultValue={editing.status} className={adminInputClass}>
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </label>
            )}
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button className="w-full" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Create customer"}
          </Button>
        </form>
      </AdminModal>
    </AdminPage>
  );
}
