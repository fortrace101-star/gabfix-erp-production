function isPreviewHost(hostname: string) {
  return hostname.startsWith("id-preview--") || hostname.startsWith("preview--");
}

export async function registerPortalServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const isPreview =
    window.self !== window.top ||
    isPreviewHost(window.location.hostname) ||
    new URLSearchParams(location.search).has("sw");
  if (!import.meta.env.PROD || isPreview) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => registration.active?.scriptURL.endsWith("/sw.js"))
        .map((registration) => registration.unregister()),
    );
    return;
  }
  await navigator.serviceWorker.register("/sw.js");
}
