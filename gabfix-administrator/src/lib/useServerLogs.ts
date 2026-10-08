/**
 * React hook: subscribe to real-time request-log events via Server-Sent Events.
 *
 * Connects to the /api/events SSE stream (already provided by the backend's
 * realtime module) and filters for `request-log` events. The browser's
 * native EventSource handles reconnection, heartbeat, and backpressure
 * automatically — no polling, no WebSocket handshake.
 *
 * Usage:
 *   const { logs, connected, error } = useServerLogs();
 */

import { useEffect, useRef, useState } from "react";
import type { RequestLog } from "@/lib/types";

const MAX_SSE_LOGS = 500;

export function useServerLogs() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bufferRef = useRef<RequestLog[]>([]);
  const connectedRef = useRef(false);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL;
    if (!baseUrl) {
      setError("VITE_API_BASE_URL is not configured");
      return;
    }

    const sseUrl = `${baseUrl}/events`;
    const es = new EventSource(sseUrl);

    es.onopen = () => {
      connectedRef.current = true;
      setConnected(true);
      setError(null);
    };

    es.onerror = () => {
      const wasConnected = connectedRef.current;
      connectedRef.current = false;
      setConnected(false);
      if (!wasConnected) {
        setError("Failed to connect to the log stream. Retrying…");
      }
    };

    // Each SSE event is typed (event: <type>); listen specifically for
    // request-log events. The payload is inside event.data as a
    // RealtimeEvent JSON blob.
    es.addEventListener("request-log", (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as {
          type: string;
          at: string;
          by?: string;
          payload?: unknown;
        };
        const log = event.payload as RequestLog;
        if (!log) return;

        bufferRef.current.push(log);
        if (bufferRef.current.length > MAX_SSE_LOGS) {
          bufferRef.current = bufferRef.current.slice(-MAX_SSE_LOGS);
        }
        setLogs([...bufferRef.current]);
      } catch {
        // Malformed event — skip silently.
      }
    });

    return () => {
      es.close();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  return { logs, connected, error };
}
