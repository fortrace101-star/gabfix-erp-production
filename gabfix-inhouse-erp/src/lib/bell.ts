import { useCallback, useEffect, useState } from "react";

/** Bell panel data layer (plan v5 F1/F2 for the admin console).
 *
 * Scope `admin` selects only rows addressed to the admin console's
 * synthetic bell; SSE `notification` events refresh the list live.
 *
 * Push support is deliberately NOT in this module: this file owns the
 * canonical bell (SSE + unread query + read marks). A separate
 * `src/lib/push.ts` owns the service-worker registration, VAPID key
 * storage and `pushSubscription` handling, and the bell panel only
 * subscribes/unsubscribes through it on first user gesture. Keeping
 * them split means a future "FCM/spa" backend can drop in without
 * touching the bell panel.
 */

export type BellItem = {
  id: string;
  template_key: string;
  entity_type: string;
  entity_id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const SCOPE = "admin";
const TOKEN_KEY = "gabfix-admin:auth-token";

const REFRESH_EVENTS = ["notification", "workspace-reset"] as const;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useBell() {
  const [items, setItems] = useState<BellItem[]>([]);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    const base = import.meta.env["VITE_API_BASE_URL"] ?? "";
    if (!base) return;
    try {
      const res = await fetch(`${base}/notifications/unread?scope=${SCOPE}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      setItems((await res.json()) as BellItem[]);
    } catch {
      /* offline: keep the last list */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const base = import.meta.env["VITE_API_BASE_URL"] ?? "";
    if (!base || typeof EventSource === "undefined") return;
    const token = localStorage.getItem(TOKEN_KEY);
    const url = token
      ? `${base}/events?access_token=${encodeURIComponent(token)}`
      : `${base}/events`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const refresh = () => void load();
    for (const type of REFRESH_EVENTS) es.addEventListener(type, refresh);
    return () => es.close();
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    const base = import.meta.env["VITE_API_BASE_URL"] ?? "";
    if (!base) return;
    try {
      await fetch(`${base}/notifications/${id}/read`, {
        method: "POST",
        headers: authHeaders(),
      });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      /* the next SSE event re-syncs */
    }
  }, []);

  const markAll = useCallback(async () => {
    const base = import.meta.env["VITE_API_BASE_URL"] ?? "";
    if (!base) return;
    try {
      await fetch(`${base}/notifications/read-all`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ scope: SCOPE }),
      });
      setItems([]);
    } catch {
      /* the next SSE event re-syncs */
    }
  }, []);

  return { items, connected, markRead, markAll, refresh: load };
}

/** Human text for a template row (payload keys mirror the server payloads). */
export function bellText(item: BellItem): { title: string; body: string } {
  const p = item.payload ?? {};
  switch (item.template_key) {
    case "job_completed":
      return {
        title: "Job completed",
        body: `${p["customer_name"] ?? "A customer"} — ${p["service_name"] ?? "service"} · balance UGX ${p["balance"] ?? "-"}`,
      };
    case "job_assigned":
      return {
        title: "Job assigned",
        body: `${p["job_number"]} — ${p["customer_name"] ?? ""}`,
      };
    case "purchase_approved":
      return {
        title: "Purchase approved",
        body: `${p["item"]} × ${p["qty"]} · UGX ${p["value"]}`,
      };
    case "payment_received":
      return {
        title: "Payment received",
        body: `Invoice ${p["invoice_number"] ?? ""} · UGX ${p["amount"] ?? "0"}`,
      };
    case "concern_raised":
      return {
        title: "Concern raised",
        body: `${p["raised_by"] ?? "A team member"} flagged ${p["job_number"] ?? "a job"} — ${p["kind"] ?? "issue"}`,
      };
    default:
      return {
        title: item.template_key.replace(/_/g, " "),
        body: "",
      };
  }
}

/** Compact relative time for the bell list. */
export function bellAge(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
