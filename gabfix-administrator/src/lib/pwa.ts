function isPreviewHost(hostname: string) {
  return hostname.startsWith("id-preview--") || hostname.startsWith("preview--");
}

/**
 * Registers the admin console's service worker in production builds and
 * unregisters any stale one in dev/preview (matching the other apps' pattern).
 */
export async function registerAdminServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const disabled =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    isPreviewHost(window.location.hostname) ||
    new URLSearchParams(window.location.search).has("sw");
  if (disabled) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => registration.active?.scriptURL.endsWith("/sw.js"))
        .map((registration) => registration.unregister()),
    );
    return;
  }
  const { registerSW } = await import("virtual:pwa-register");
  registerSW({ immediate: true });
}
