import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { portalApi } from "@/lib/api";
import {
  canPush,
  requestPushPermission,
  unregisterPush,
  loadVapidKeys,
  saveVapidKeys,
} from "@/lib/push";

/**
 * Bell panel (plan v5 F1/F2) for the employee portal: unread notifications
 * for the signed-in employee — job.assigned rows land here — plus the
 * portal's synthetic app bell. Refreshes live over SSE; uses the portal's
 * native CSS classes (styles.css), not tailwind.
 */

type BellItem = {
  id: string;
  template_key: string;
  entity_type: string;
  entity_id: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type PushConsent = {
  enabled: boolean;
  granted: boolean;
};

const REFRESH_EVENTS = ["notification", "job-created", "job-updated", "workspace-reset"] as const;

export function PortalBell({ employeeId }: { employeeId?: string }) {
  const [items, setItems] = useState<BellItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [open, setOpen] = useState(false);
  const [pushConsent, setPushConsent] = useState<PushConsent>({
    enabled: false,
    granted: false,
  });
  const [pushPermission, setPushPermission] = useState<"prompt" | "granted" | "denied">("prompt");
  const ref = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  // Load persisted push consent + detect browser push capability.
  useEffect(() => {
    const checkPush = async () => {
      const enabled = localStorage.getItem("gabfix:push:enabled") === "true";
      setPushConsent({ enabled, granted: canPush() });
      const permission = await Notification.permission;
      setPushPermission(permission as "prompt" | "granted" | "denied");
    };
    checkPush();
  }, []);

  // Toggle push consent on/off + request permission on first enable.
  const togglePush = async (enabled: boolean) => {
    if (enabled && !canPush()) {
      setPushConsent((p) => ({ ...p, enabled: true, granted: false }));
      setPushPermission("denied");
      return;
    }
    if (enabled) {
      const permission = await Notification.requestPermission();
      setPushPermission(permission as "prompt" | "granted" | "denied");
      if (permission === "granted") {
        try {
          await requestPushPermission(
            portalApi.baseUrl ?? "",
            "portal",
            () => setPushConsent((p) => ({ ...p, granted: true })),
            () => setPushConsent((p) => ({ ...p, granted: false })),
          );
        } catch {
          setPushConsent((p) => ({ ...p, granted: false }));
        }
      }
    } else {
      try {
        await unregisterPush(portalApi.baseUrl ?? "", "portal");
      } catch {
        /* best-effort */
      }
      setPushConsent((p) => ({ ...p, granted: false }));
    }
    localStorage.setItem("gabfix:push:enabled", String(enabled));
    setPushConsent((p) => ({ ...p, enabled }));
  };

  useEffect(() => {
    let alive = true;
    const fetchItems = () => {
      const base = portalApi.baseUrl;
      if (!base) return;
      const employee = employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : "";
      portalApi
        .get<BellItem[]>(`/notifications/unread?scope=portal${employee}`)
        .then((rows) => {
          if (alive) setItems(rows);
        })
        .catch(() => {
          /* keep the last list */
        });
    };
    fetchItems();
    const token = localStorage.getItem("gabfix:auth-token");
    const base = portalApi.baseUrl;
    if (!base || typeof EventSource === "undefined") return () => undefined;
    const url = token
      ? `${base}/events?access_token=${encodeURIComponent(token)}`
      : `${base}/events`;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    for (const type of REFRESH_EVENTS) es.addEventListener(type, fetchItems);
    return () => {
      alive = false;
      es.close();
    };
  }, [employeeId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const markRead = async (id: string) => {
    try {
      await portalApi.request(`/notifications/${id}/read`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      /* the next SSE event re-syncs */
    }
  };

  const markAll = async () => {
    try {
      await portalApi.request("/notifications/read-all", {
        method: "POST",
        body: JSON.stringify({ scope: "portal", ...(employeeId ? { employeeId } : {}) }),
      });
      setItems([]);
    } catch {
      /* the next SSE event re-syncs */
    }
  };

  const text = (item: BellItem): { title: string; body: string } => {
    const p = item.payload ?? {};
    switch (item.template_key) {
      case "job_assigned":
        return {
          title: "New job assigned",
          body: `${p["job_number"]} — ${p["customer_name"]}${p["scheduled"] ? ` · ${p["scheduled"]}` : ""}${p["address"] ? ` · ${p["address"]}` : ""}`,
        };
      case "job_completion":
        return {
          title: "Job completed",
          body: `${p["customer_name"] ?? "A customer"} — ${p["service_name"] ?? "service"} · balance ${p["balance"] ?? "-"}`,
        };
      case "laundry_ready":
        return {
          title: "Laundry ready",
          body: `${p["customer_name"]}'s order ${p["order_number"]} · UGX ${p["total"]}`,
        };
      case "purchase_approved":
        return {
          title: "Purchase approved",
          body: `${p["item"]} × ${p["qty"]} · UGX ${p["value"]}`,
        };
      case "concern_raised":
        return {
          title: "Concern raised",
          body: `${p["raised_by"] ?? "A team member"} flagged ${p["job_number"] ?? "a job"} — ${p["kind"] ?? "issue"}`,
        };
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

  // Push newly-arrived notifications to a toast (manager push via bell + toast).
  // On first paint we mark existing rows seen, so only SSE-driven additions toasts.
  useEffect(() => {
    if (mountedRef.current) {
      items.forEach((item) => seenRef.current.add(item.id));
      mountedRef.current = false;
      return;
    }
    const unseen = items.filter((item) => !seenRef.current.has(item.id));
    unseen.forEach((item) => {
      seenRef.current.add(item.id);
      const { title, body } = text(item);
      toast(title, { description: body || undefined });
    });
  }, [items, text]);

  // Rendered with the portal's own design language (styles.css): .notification-popover,
  // .popover-heading, .notice / .notice-dot and .bell-btn are the classes the sheet was
  // written for, so the panel keeps the workspace's colours instead of inline tokens.
  return (
    <div className="notification-wrap" ref={ref}>
      <button
        type="button"
        aria-label={`Notifications${items.length ? ` (${items.length} unread)` : ""}`}
        className="bell-btn"
        title="Notifications"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} />
        {items.length > 0 && <i />}
      </button>
      {open && (
        <div className="notification-popover" role="dialog" aria-label="Notifications">
          <div className="popover-heading">
            <strong>Notifications</strong>
            <span className="muted-note">
              {connected ? "Live" : "Reconnecting…"}
              {items.length > 0 ? ` · ${items.length} unread` : ""}
            </span>
          </div>
          {items.length === 0 && (
            <p className="notice-empty">Nothing here yet — jobs assigned to you land here live.</p>
          )}
          {items.map((item) => {
            const { title, body } = text(item);
            return (
              <button
                type="button"
                className="notice"
                key={item.id}
                onClick={() => void markRead(item.id)}
              >
                <span className="notice-dot" />
                <span>
                  <strong>{title}</strong>
                  <p>{body}</p>
                  <small>{age(item.created_at)}</small>
                </span>
              </button>
            );
          })}
          {items.length > 0 && (
            <>
              <div className="popover-rule" />
              <div className="popover-actions">
                <Button variant="ghost" className="text-link" onClick={() => void markAll()}>
                  Mark all read
                </Button>
                <button
                  type="button"
                  className="push-toggle"
                  onClick={() => void togglePush(!pushConsent.enabled)}
                >
                  {pushConsent.enabled ? "Disable push" : "Push live"}
                </button>
              </div>
              {pushConsent.enabled && !pushConsent.granted && (
                <p className="muted-note">
                  Push is on but the browser has not been granted permission.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
