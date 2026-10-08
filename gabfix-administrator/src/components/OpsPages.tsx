import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { AdminModal, AdminPage, adminFieldLabel, adminInputClass } from "@/components/AdminPage";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api";
import { useWorkspaceData, useWorkspaceSse } from "@/lib/workspace-data";

const money = (v: number) => `UGX ${Math.round(v).toLocaleString("en-UG")}`;

/* ── Inventory ────────────────────────────────────────────────────────────── */

export function InventoryPage({ onBack }: { onBack?: () => void }) {
  const { data, error, refresh } = useWorkspaceData();
  useWorkspaceSse(refresh);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);
    setFormError("");
    try {
      await apiClient.request("/inventory", {
        method: "POST",
        body: JSON.stringify({
          name: String(fd.get("name")),
          category: String(fd.get("category")),
          unit: String(fd.get("unit")),
          quantity: Number(fd.get("quantity") || 0),
          minimum: Number(fd.get("minimum") || 0),
          cost: Number(fd.get("cost") || 0),
        }),
      });
      setOpen(false);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not create item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminPage
      title="Inventory"
      subtitle="Facility and contract stock across the workspace"
      onBack={onBack}
      loading={!data}
      error={error}
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus /> New item
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3 text-right">On hand</th>
              <th className="px-4 py-3 text-right">Reorder at</th>
              <th className="px-4 py-3 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {(data?.inventory ?? []).map((item) => (
              <tr key={item.id} className="border-t border-border">
                <td className="px-4 py-3">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.category}</p>
                </td>
                <td className="px-4 py-3">{item.kind}</td>
                <td className="px-4 py-3 text-right">
                  {item.quantity} {item.unit}
                </td>
                <td className="px-4 py-3 text-right">{item.minimum}</td>
                <td className="px-4 py-3 text-right">{money(item.quantity * item.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AdminModal open={open} title="New inventory item" onClose={() => setOpen(null)}>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-2">
            <span className={adminFieldLabel}>Name</span>
            <input name="name" required className={adminInputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Category</span>
              <input name="category" required className={adminInputClass} />
            </label>
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Unit</span>
              <input name="unit" required className={adminInputClass} placeholder="bag, L, pcs" />
            </label>
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Quantity</span>
              <input name="quantity" type="number" step="any" className={adminInputClass} />
            </label>
            <label className="block space-y-2">
              <span className={adminFieldLabel}>Reorder level</span>
              <input name="minimum" type="number" step="any" className={adminInputClass} />
            </label>
            <label className="block space-y-2 col-span-2">
              <span className={adminFieldLabel}>Unit cost (UGX)</span>
              <input name="cost" type="number" min="0" className={adminInputClass} />
            </label>
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <Button className="w-full" disabled={saving}>
            {saving ? "Saving…" : "Create item"}
          </Button>
        </form>
      </AdminModal>
    </AdminPage>
  );
}

/* ── Assets ───────────────────────────────────────────────────────────────── */

export function AssetsPage({ onBack }: { onBack?: () => void }) {
  const { data, error, refresh } = useWorkspaceData();
  useWorkspaceSse(refresh);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function depreciate(id: string) {
    setBusyId(id);
    try {
      await apiClient.request(`/assets/${id}/depreciate`, { method: "POST" });
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminPage
      title="Assets"
      subtitle="Equipment register with book values and monthly depreciation"
      onBack={onBack}
      loading={!data}
      error={error}
    >
      <div className="space-y-3">
        {(data?.equipment ?? []).map((eq) => (
          <div key={eq.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div>
              <p className="text-sm font-semibold">{eq.name}</p>
              <p className="text-xs text-muted-foreground">
                {eq.serialNumber || "no serial"} · {eq.condition} · bought {eq.purchaseDate?.slice(0, 10) || "—"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold">{money(eq.bookValue)}</p>
                <p className="text-xs text-muted-foreground">book value</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === eq.id}
                onClick={() => depreciate(eq.id)}
              >
                Depreciate
              </Button>
            </div>
          </div>
        ))}
      </div>
    </AdminPage>
  );
}

/* ── Messages (notifications bell + feedback) ─────────────────────────────── */

export function MessagesPage({ onBack }: { onBack?: () => void }) {
  const { data, error } = useWorkspaceData();

  return (
    <AdminPage
      title="Messages"
      subtitle="Customer notification feed and feedback status"
      onBack={onBack}
      loading={!data}
      error={error}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Laundry orders in flight</h2>
          <p className="mt-1 text-xs text-muted-foreground">Appreciation messages schedule 24h after completion.</p>
          <ul className="mt-4 space-y-2">
            {(data?.laundry ?? []).slice(0, 6).map((l) => (
              <li key={l.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-mono text-xs">{l.number}</span>
                <span>{l.status}</span>
                <span className="text-xs text-muted-foreground">{money(l.total)}</span>
              </li>
            ))}
            {(data?.laundry ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">Nothing in flight.</li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Recent payments (receipts sent)</h2>
          <ul className="mt-4 space-y-2">
            {(data?.payments ?? []).slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-mono text-xs">{p.number}</span>
                <span className="text-xs text-muted-foreground">{p.receivedAt?.slice(0, 10)}</span>
                <span>{money(p.amount)}</span>
              </li>
            ))}
            {(data?.payments ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">No payments yet.</li>
            )}
          </ul>
        </div>
      </div>
    </AdminPage>
  );
}

/* ── Sync health (approvals + integration state) ──────────────────────────── */

export function SyncHealthPage({ onBack }: { onBack?: () => void }) {
  const { data, error, refresh } = useWorkspaceData();
  useWorkspaceSse(refresh);
  const [modal, setModal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [decideError, setDecideError] = useState("");

  async function decide(id: string, status: "Approved" | "Rejected") {
    setSaving(true);
    setDecideError("");
    try {
      await apiClient.request(`/store/purchase-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setModal(null);
      refresh();
    } catch (error: any) {
      setDecideError(error.message ?? "Could not decide request");
    } finally {
      setSaving(false);
    }
  }

  const pending = (data?.purchaseRequests ?? []).filter((r) => r.status === "Pending approval");

  return (
    <AdminPage
      title="Sync health & approvals"
      subtitle="Store purchase requests and the cross-app integration state"
      onBack={onBack}
      loading={!data}
      error={error}
    >
      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold">Purchase requests awaiting decision</h2>
        <div className="space-y-2">
          {pending.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div>
                <p className="text-sm font-semibold">{r.description} · qty {r.qty}</p>
                <p className="text-xs text-muted-foreground">
                  raised by {r.requestedBy || "store"} on {r.requestedOn} · {money(r.value)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decide(r.id, "Approved")} disabled={saving}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide(r.id, "Rejected")} disabled={saving}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
          {pending.length === 0 && (
            <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Nothing awaiting approval — store requests appear here in real time via SSE.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">All purchase requests</h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Raised</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {(data?.purchaseRequests ?? []).map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-border hover:bg-muted/35" onClick={() => setModal(r.id)}>
                  <td className="px-4 py-3">{r.description}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.requestedOn}</td>
                  <td className="px-4 py-3">{r.status}</td>
                  <td className="px-4 py-3 text-right">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AdminModal
        open={Boolean(modal)}
        title="Purchase request"
        description="Approving notifies the store app instantly over SSE."
        onClose={() => setModal(null)}
      >
        {(() => {
          const r = (data?.purchaseRequests ?? []).find((x) => x.id === modal);
          if (!r) return null;
          return (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-4 text-sm">
                <p className="font-semibold">{r.description}</p>
                <p className="mt-1 text-muted-foreground">
                  Qty {r.qty} · {money(r.value)} · raised by {r.requestedBy || "store"} on {r.requestedOn}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Status: <strong>{r.status}</strong>
                </p>
              </div>
                             {r.status === "Pending approval" && (
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => decide(r.id, "Approved")} disabled={saving}>
                    Approve
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => decide(r.id, "Rejected")} disabled={saving}>
                    Reject
                  </Button>
                </div>
              )}
              {decideError && (
              <p className="mt-2 text-sm text-destructive">{decideError}</p>
            )}
            </div>
          );
        })()}
      </AdminModal>
    </AdminPage>
  );
}
