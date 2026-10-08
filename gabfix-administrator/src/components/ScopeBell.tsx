import { useCallback, useEffect, useState, useRef } from "react";
import { Bell, CheckCheck, LoaderCircle } from "lucide-react";

/** Bell item shape (matches the server's `unreadNotifications` return row). */
export type BellItem = {
  id: string;
  template_key: string;
  entity_type: string;
  entity_id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

/**
 * Generic per-scope notification bell. Vendored per app per plan §8 — no shared
 * source imports. Pass `scope` (admin/store/laundry/portal), `tokenKey`, and,
 * optionally, an `apiGet` override for apps that use a different client.
 */
export function ScopeBell({
  scope,
  tokenKey,
  title = "Notifications",
  emptyText = "No notifications",
  primaryKey,
}: {
  scope: "admin" | "store" | "laundry" | "portal";
  tokenKey: string;
  title?: string;
  emptyText?: string;
  primaryKey?: string;
}) {
  const [items, setItems] = useState<BellItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!base) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${base}/notifications/unread?scope=${scope}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem(tokenKey)}` },
      });
      if (!res.ok) return;
      setItems(await res.json());
    } catch {
      /* keep the last list */
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!base || typeof EventSource === "undefined") {
      setLoading(false);
      return () => undefined;
    }
    const token = localStorage.getItem(tokenKey);
    const url = token ? `${base}/events?access_token=${encodeURIComponent(token)}` : `${base}/events`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const refresh = () => void load();
    const types: string[] = [
      "notification",
      "job-created",
      "job-updated",
      "customer-created",
      "expense-created",
      "laundry-updated",
      "purchase-created",
      "purchase-approved",
      "store-updated",
      "workspace-reset",
      "settings-updated",
      "employees-updated",
    ];
    for (const type of types) es.addEventListener(type, refresh);
    return () => {
      es.close();
    };
  }, [load]);

  const markRead = useCallback(
    async (id: string) => {
      const base = import.meta.env.VITE_API_BASE_URL ?? "";
      if (!base) return;
      try {
        await fetch(`${base}/notifications/${id}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem(tokenKey)}` },
        });
        setItems((prev) => prev.filter((item) => item.id !== id));
      } catch {
        /* the next SSE event re-syncs */
      }
    },
    [tokenKey],
  );

  const markAll = useCallback(async () => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!base) return;
    try {
      await fetch(`${base}/notifications/read-all`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem(tokenKey)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scope }),
      });
      setItems([]);
    } catch {
      /* the next SSE event re-syncs */
    }
  }, [tokenKey, scope]);

  const text = (item: BellItem): { title: string; body: string } => {
    const p = item.payload ?? {};
    switch (item.template_key) {
      case "job_completion":
        return {
          title: "Job completed",
          body: `${p["customer_name"] ?? "A customer"} — ${p["service_name"] ?? "service"} · balance ${p["balance"] ?? "–"}`,
        };
      case "job_appreciation":
        return { title: "Feedback request scheduled", body: `Appreciation queued for ${p["customer_name"] ?? "the customer"}` };
      case "laundry_ready":
        return { title: "Laundry ready", body: `${p["customer_name"]}'s order ${p["order_number"]} is ready · UGX ${p["total"]}` };
      case "job_assigned":
        return { title: "Job assigned", body: `${p["job_number"]} — ${p["customer_name"]}${p["scheduled"] ? ` · ${p["scheduled"]}` : ""}` };
      case "purchase_approved":
        return { title: "Purchase approved", body: `${p["item"]} × ${p["qty"]} · UGX ${p["value"]}` };
      case "feedback_received":
        return {
          title: "Customer feedback",
          body: `${(p["rating"] ?? 0)
            .toString()
            .padStart(5, "★")} ${(p["comment"] ?? "").slice(0, 140) ?? ""}${(p["job_number"] ? ` (${p["job_number"]})` : "")}`
            .trim(),
        };
      case "notification":
        return { title: p["title"] as string, body: String(p["body"] ?? "") };
      default:
        return { title: item.template_key.replace(/_/g, " "), body: "" };
    }
  };

  const age = (iso: string): string => {
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return "";
    const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${items.length ? ` (${items.length} unread)` : ""}`}
        className="relative text-muted-foreground"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="relative inline-flex">
          <Bell className="size-5" strokeWidth={1.75} />
          {items.length >= 10 ? (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 size-2 rounded-full bg-destructive"
            />
          ) : items.length > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-2 -right-2 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-bold leading-none text-destructive-foreground"
            >
              {items.length}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 size-2 rounded-full bg-gold"
            />
          )}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-80 max-h-96 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">{title}</p>
            <div className="flex items-center gap-2">
              <span
                className={`size-1.5 rounded-full ${connected ? "bg-primary" : "bg-muted-foreground/40"}`}
                title={connected ? "Live" : "Reconnecting…"}
              />
              {items.length > 0 && (
                <button
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => void markAll()}
                >
                  <CheckCheck className="size-3.5" /> Mark all read
                </button>
              )}
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              items.map((item) => {
                const { title, body } = text(item);
                return (
                  <button
                    key={item.id}
                    className="block w-full border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/40"
                    onClick={() => void markRead(item.id)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{title}</p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{age(item.created_at)}</span>
                    </div>
                    {body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{body}</p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
