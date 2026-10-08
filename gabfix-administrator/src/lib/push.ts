import type { PushSubscription } from "web-push";

/**
 * PWA push capability for the admin console.
 *
 * Flow (per app, no shared source imports):
 *   1. The admin settings page flips `settings.pushEnabled` (server-side flag)
 *      and stores the VAPID public key.
 *   2. On first user gesture (or on load after login), the app asks for
 *      Notification permission and registers the service worker.
 *   3. It calls POST /api/push/subscriptions with the VAPID public key and
 *      the generated `PushSubscription`, and the server upserts the row.
 *   4. As long as `pushEnabled` is on and the device is active, the scheduler
 *      fans out `push` channel notifications to every subscribed device.
 */

export type PushDevice = {
  app_id: string;
  device_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

const TOKEN_KEY = "gabfix-admin:auth-token";

/** Ask for and store the user's Notification permission. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "denied") return false;
  if (Notification.permission === "granted") return true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Fetch the VAPID public key from the server settings (if a custom one is set). */
export async function loadVapidPublicKey(
  baseUrl: string,
): Promise<string | null> {
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/settings`, {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
    });
    if (!res.ok) return null;
    const settings = (await res.json()) as {
      pushEnabled?: boolean;
      vapidPublicKey?: string;
    };
    return settings.vapidPublicKey?.trim() || null;
  } catch {
    return null;
  }
}

/** Register the SW and subscribe the device to push. */
export async function registerPushDevice(
  baseUrl: string,
  appId: string,
): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  constregistration = await navigator.serviceWorker.register(`/sw.js`);
  const reg = await registration.pushManager.getSubscription();
  if (reg) return reg;

  const permission = await requestNotificationPermission();
  if (!permission || !("PushManager" in window)) return null;

  const key = await loadVapidPublicKey(baseUrl);
  if (!key) return null;

  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });

  // Persist to the server so the scheduler can fan out.
  if (baseUrl) {
    try {
      await fetch(`${baseUrl}/push/subscriptions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}`,
        },
        body: JSON.stringify({
          app_id: appId,
          device_id: sub.endpoint.split("/").pop() ?? crypto.randomUUID(),
          endpoint: sub.endpoint,
          p256dh: sub.getKey("p256dh")?.toString("base64") ?? "",
          auth: sub.getKey("auth")?.toString("base64") ?? "",
        }),
      });
    } catch {
      // Best-effort persistence — the subscription still works for this session.
    }
  }

  return sub;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Clean = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Clean);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
