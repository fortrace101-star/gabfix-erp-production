import { useCallback, useEffect, useState } from "react";

/**
 * Bell panel data layer (plan v5 F1/F2 for the admin console).
 *
 * Polls nothing: the first load fetches the scoped unread list, then every
 * SSE `notification` (and workspace) event re-fetches. `scope=admin` selects
 * the synthetic app-addressed bell plus customer rows so the console only
 * sees events that concern it.
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

const REFRESH_EVENTS = [
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
] as const;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useBell() {
  const [items, setItems] = useState<BellItem[]>([]);
  const [connected, setConnected] = useState(false);

  const load = useCallback(async () => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!base) return;
    try {
      const res = await fetch(`${base}/notifications/unread?scope=${SCOPE}`, { headers: authHeaders() });
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
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    if (!base || typeof EventSource === "undefined") return;
    const token = localStorage.getItem(TOKEN_KEY);
    const url = token ? `${base}/events?access_token=${encodeURIComponent(token)}` : `${base}/events`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const refresh = () => void load();
    for (const type of REFRESH_EVENTS) es.addEventListener(type, refresh);
    return () => es.close();
  }, [load]);

  const markRead = useCallback(
    async (id: string) => {
      const base = import.meta.env.VITE_API_BASE_URL ?? "";
      if (!base) return;
      try {
        await fetch(`${base}/notifications/${id}/read`, { method: "POST", headers: authHeaders() });
        setItems((prev) => prev.filter((item) => item.id !== id));
      } catch {
        /* the next SSE event re-syncs */
      }
    },
    [],
  );

  const markAll = useCallback(async () => {
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
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
    case "job_completion":
      return {
        title: "Job completed",
        body: `${p.customer_name ?? "A customer"} — ${p.service_name ?? "service"} · balance ${p.balance ?? "-"}`,
      };
    case "job_appreciation":
      return { title: "Feedback request scheduled", body: `Appreciation queued for ${p.customer_name ?? "the customer"}` };
    case "laundry_ready":
      return { title: "Laundry ready", body: `${p.customer_name}'s order ${p.order_number} is ready · UGX ${p.total}` };
    case "job_assigned":
      return { title: "Job assigned", body: `${p.job_number} — ${p.customer_name}${p.scheduled ? ` · ${p.scheduled}` : ""}` };
    case "purchase_approved":
      return { title: "Purchase approved", body: `${p.item} × ${p.qty} · UGX ${p.value}` };
    case "feedback_received":
      return {
        title: "Customer feedback",
        body: `${"★".repeat(Math.max(0, Math.min(5, Number(p.rating) || 0)))} ${p.comment ?? ""}${p.job_number ? ` (${p.job_number})` : ""}`.trim(),
      };
    default:
      return { title: item.template_key.replace(/_/g, " "), body: "" };
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
