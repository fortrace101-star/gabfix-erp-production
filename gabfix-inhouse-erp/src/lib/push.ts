/** Push-side service worker registration + VAPID + per-device tokens.
 *
 * Design note (plan §F): the cross-app fabric is the existing SSE bus
 * (`GET /api/events`), so push is an *optional* on-top feature that the
 * server schedules / leaves to web-push when VAPID credentials exist.
 * This module is deliberately decoupled from `bell.ts`: it only handles
 * the push channel (registration + subscribe/unsubscribe + token sync),
 * while the bell owns (un)read state over SSE.
 *
 * Delivery targets decided here (plan §5 design question):
 *   - a) Delivery target: all 4 apps (each PWA registers its own
 *     VAPID subscription with a server-known `app_id` claim), so a
 *     purchase.approved event can ring the Store bell even though the
 *     Store app was closed, provided the Store PC is online.
 *   - b) Transport: SW + VAPID (pushManager) instead of SPA FCM: one
 *     server-to-push path, no third-party key management, and the
 *     service worker already exists (vite-plugin-pwa, generateSW) in
 *     all four apps. SPA FCM would require a separate FCM project + a
 *     client SDK per app for no added delivery benefit.
 *   - c) Surface: notification bell only (in-app), plus optional webhooks
 *     for invoices/payments/laundry (already wired in `routes/webhooks`).
 */

type VapidKeys = {
  publicKey: string | null;
  privateKey: string | null;
};

const STORAGE_KEY = "gabfix:push:vapid-keys";
const AUTH_TOKEN_KEY = "gabfix:auth-token";
const DEVICE_TOKEN_KEY = "gabfix:push:device-token";
const SW_READY_TIMEOUT_MS = 5000;

/** Bound a promise that may never settle (e.g. `serviceWorker.ready` with no
 *  registered worker) so callers fall through to their own failure path. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Service worker did not become ready")), ms),
    ),
  ]);
}

/** Pick up VAPID keys from localStorage (set once by the admin settings UI). */
export function loadVapidKeys(): VapidKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { publicKey: null, privateKey: null };
    return JSON.parse(raw) as VapidKeys;
  } catch {
    return { publicKey: null, privateKey: null };
  }
}

export function saveVapidKeys(keys: VapidKeys): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* storage full / private mode — push is disabled, not fatal */
  }
}

export function clearVapidKeys(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Register the app's service worker in production (matching the per-app pwa.ts).
 *
 * `virtual:pwa-register` is injected by `vite-plugin-pwa`. The portal builds on
 * the shared TanStack Start config (`vite.config.ts`), which does not include
 * that plugin, so a literal specifier would fail Vite's import analysis and
 * take the whole module down with it. The specifier is therefore resolved at
 * runtime and falls back to a plain registration — the same `/sw.js` that
 * `generateSW` would emit. Push is optional (plan §F): the SSE bell is the
 * permanent path.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const disabled =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    /^(id-preview--|preview--)/.test(window.location.hostname) ||
    new URLSearchParams(window.location.search).has("sw");
  if (disabled) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((r) => r.active?.scriptURL.endsWith("/sw.js"))
        .map((r) => r.unregister()),
    );
    return;
  }
  try {
    const pwaRegisterModule = "virtual:pwa-register";
    const { registerSW } = (await import(/* @vite-ignore */ pwaRegisterModule)) as {
      registerSW: (options?: { immediate?: boolean }) => void;
    };
    registerSW({ immediate: true });
  } catch {
    // vite-plugin-pwa is not enabled in this build — register directly.
    await navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}

/** Instruct the service worker (running in the SW context) to subscribe, then
 *  POST the resulting `PushSubscription` to the server. */
export async function registerPushSubscription(
  baseUrl: string,
  appId: string,
  onResult: (sub: PushSubscription | null) => void,
): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    onResult(null);
    return;
  }
  // `serviceWorker.ready` never settles when no worker is registered (this
  // build ships none in dev), which would leave the bell's push toggle spinning
  // forever — so bound the wait and let the existing catch report "no push".
  const registration = await withTimeout(navigator.serviceWorker.ready, SW_READY_TIMEOUT_MS);
  try {
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        import.meta.env["VITE_VAPID_PUBLIC_KEY"] ?? "",
      ) as unknown as ArrayBuffer,
    });
    onResult(sub);

    syncDeviceToken(sub, baseUrl, appId);
  } catch (error) {
    // The user denied permission, or the browser lacks push.
    if ((error as Error).name === "NotAllowedError") {
      clearVapidKeys();
    }
    onResult(null);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return raw;
}

/** POST the pushSubscription to the server for VAPID token derivation. */
async function syncDeviceToken(
  sub: PushSubscription,
  baseUrl: string,
  appId: string,
): Promise<void> {
  try {
    const authToken = localStorage.getItem("gabfix:auth-token") ?? "";
    const employeeRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!employeeRes.ok) return;
    const employee = (await employeeRes.json()) as { user?: { id: string } };
    const employeeId = employee.user?.id;
    if (!employeeId) return;
    const payload = {
      app_id: appId,
      employee_id: employeeId,
      subscription: {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.getKey("p256dh")
            ? btoa(String.fromCharCode(...(sub.getKey("p256dh") as unknown as number[])))
            : "",
          auth: sub.getKey("auth")
            ? btoa(String.fromCharCode(...(sub.getKey("auth") as unknown as number[])))
            : "",
        },
      },
      device_id: localStorage.getItem(DEVICE_TOKEN_KEY) ?? "",
      updated_at: new Date().toISOString(),
    };
    await fetch(`${baseUrl}/push/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    try {
      localStorage.setItem(DEVICE_TOKEN_KEY, payload.device_id || crypto.randomUUID());
    } catch {
      /* ignore */
    }
  } catch {
    /* push sync is best-effort; the SSE bell still updates live */
  }
}

/** Return whether the browser supports push. */
export function canPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/** Ask the user for permission and, on grant, register the SW + subscribe. */
export async function requestPushPermission(
  baseUrl: string,
  appId: string,
  onGranted: (sub: PushSubscription | null) => void,
  onDenied: () => void,
): Promise<void> {
  if (!canPush()) {
    onDenied();
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    onDenied();
    return;
  }
  try {
    await registerPushSubscription(baseUrl, appId, onGranted);
  } catch {
    onDenied();
  }
}

/** Unsubscribe + tell the server to drop this device's token. */
export async function unregisterPush(baseUrl: string, appId: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  try {
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;
    await sub.unsubscribe();
    const authToken = localStorage.getItem("gabfix:auth-token") ?? "";
    await fetch(`${baseUrl}/push/subscriptions`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        app_id: appId,
        employee_id: localStorage.getItem("gabfix:auth-token")
          ? await (
              await fetch(`${baseUrl}/auth/me`, {
                headers: { Authorization: `Bearer ${authToken}` },
              })
            )
              .json()
              .then((j) => j.user?.id)
          : "",
        device_id: localStorage.getItem(DEVICE_TOKEN_KEY) ?? "",
      }),
    });
    try {
      localStorage.removeItem(DEVICE_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}
