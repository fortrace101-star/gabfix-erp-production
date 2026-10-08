import { useCallback, useEffect, useRef, useState } from "react";
import { portalApi } from "@/lib/api";

/**
 * Field beacon (plan D3): turns the technician's phone into a GPS tracker.
 *
 * - Resolves the employee's registered device from GET /api/devices
 *   (the admin Devices page is the source of truth for msisdn ↔ employee).
 * - Watches the browser geolocation and POSTs each fix to
 *   /api/telemetry/pings, which evaluates geofences and updates the live map.
 * - Offline or failed sends land in a localStorage outbox and drain when the
 *   connection returns — the trail keeps working with zero coverage.
 */

const QUEUE_KEY = "gabfix:field-ping-outbox";
const DEVICE_KEY = "gabfix:beacon-device-id";
/** Battery-friendly cadence: geolocation only wakes on movement; we cap re-sends. */
const MIN_SEND_INTERVAL_MS = 20_000;

export type QueuedPing = {
  deviceId: string;
  employeeId: string | null;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading: number | null;
  recordedAt: string;
};

export type BeaconStatus = "idle" | "acquiring" | "live" | "denied" | "unsupported" | "error";

export function readQueue(): QueuedPing[] {
  try {
    const stored = localStorage.getItem(QUEUE_KEY);
    const parsed = stored ? (JSON.parse(stored) as QueuedPing[]) : [];
    return Array.isArray(parsed) ? parsed.slice(-50) : [];
  } catch {
    return [];
  }
}

function writeQueue(pings: QueuedPing[]): void {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(pings.slice(-50)));
}

export function queuePing(ping: QueuedPing): number {
  const queue = readQueue();
  queue.push(ping);
  writeQueue(queue);
  return queue.length;
}

type DeviceRow = { id: string; employeeId: string | null; active: boolean; label: string };

export function useBeacon(employeeId: string | null) {
  const [status, setStatus] = useState<BeaconStatus>("idle");
  const [deviceId, setDeviceId] = useState<string | null>(() => localStorage.getItem(DEVICE_KEY));
  const [deviceLabel, setDeviceLabel] = useState<string>("");
  const [fix, setFix] = useState<{
    lat: number;
    lng: number;
    accuracy: number | null;
    at: string;
  } | null>(null);
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(() => readQueue().length);
  const [error, setError] = useState("");
  const watchId = useRef<number | null>(null);
  const lastSend = useRef(0);

  // Resolve this employee's registered device (admin Devices page assigns it).
  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    portalApi
      .get<DeviceRow[]>("/devices")
      .then((rows) => {
        if (!alive) return;
        const mine = rows.find((d) => d.active && d.employeeId === employeeId);
        if (mine) {
          setDeviceId(mine.id);
          setDeviceLabel(mine.label);
          localStorage.setItem(DEVICE_KEY, mine.id);
        } else {
          setDeviceId(null);
          setDeviceLabel("");
          localStorage.removeItem(DEVICE_KEY);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [employeeId]);

  const send = useCallback(async (ping: QueuedPing): Promise<boolean> => {
    try {
      await portalApi.request("/telemetry/pings", { method: "POST", body: JSON.stringify(ping) });
      return true;
    } catch {
      return false;
    }
  }, []);

  const drain = useCallback(async () => {
    const pending = readQueue();
    if (!pending.length) return;
    const remaining: QueuedPing[] = [];
    for (const ping of pending) {
      if (await send(ping)) setSent((s) => s + 1);
      else remaining.push(ping);
    }
    writeQueue(remaining);
    setQueued(remaining.length);
  }, [send]);

  // Connection returns → flush the outbox.
  useEffect(() => {
    const onOnline = () => void drain();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [drain]);

  const onFix = useCallback(
    (position: GeolocationPosition) => {
      const coords = position.coords;
      setFix({
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy: coords.accuracy ?? null,
        at: new Date().toISOString(),
      });
      if (!deviceId) return;
      // Throttle: the watch fires often; the server needs ~a ping per 20s.
      const now = Date.now();
      if (now - lastSend.current < MIN_SEND_INTERVAL_MS) return;
      lastSend.current = now;
      const ping: QueuedPing = {
        deviceId,
        employeeId,
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy_m: coords.accuracy ?? null,
        speed_kmh: coords.speed != null ? Math.max(0, coords.speed * 3.6) : null,
        heading: coords.heading ?? null,
        recordedAt: new Date().toISOString(),
      };
      void (async () => {
        const ok = navigator.onLine && (await send(ping));
        if (ok) {
          setSent((s) => s + 1);
        } else {
          setQueued(queuePing(ping));
        }
      })();
    },
    [deviceId, employeeId, send],
  );

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    if (!deviceId) {
      setError(
        "No registered device for your account — ask an admin to register one on the Devices page.",
      );
      return;
    }
    setError("");
    setStatus("acquiring");
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        setStatus("live");
        onFix(position);
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        setError(err.message || "Location unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 25_000 },
    );
  }, [deviceId, onFix]);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setStatus("idle");
  }, []);

  // Stop the watch when the page unloads.
  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    [],
  );

  return { status, fix, sent, queued, error, deviceId, deviceLabel, start, stop, drain };
}
