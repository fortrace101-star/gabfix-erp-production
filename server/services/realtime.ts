/**
 * Realtime event bus (Phase 0.11, plan section 8.9).
 *
 * A tiny in-process pub/sub: write handlers call `publish()` after a commit,
 * and `routes/events.ts` streams those events to every connected browser over
 * Server-Sent Events. The 15s heartbeat keeps proxies from idling the
 * connection out; the browser also re-validates on `data-refresh` (belt and
 * suspenders — an SSE gap degrades to a 15s-late refresh, never staleness).
 *
 * Single-process only. Multi-instance deployments upgrade to Socket.IO in
 * Phase 6, which replaces this module behind the same client contract.
 */

import type { Response } from 'express';

export type RealtimeEvent = {
     type: 'job-created' | 'job-updated' | 'customer-created' | 'expense-created' | 'equipment-created' | 'equipment-updated' | 'inventory-created' | 'inventory-updated' | 'payment-created' | 'asset-depreciated' | 'laundry-updated' | 'notification' | 'workspace-reset' | 'ping.recorded' | 'request-log' | 'settings-updated' | 'employees-updated' | 'store-updated' | 'purchase-created' | 'purchase-approved';
  at: string;
  by?: string;
  /** Optional payload that the SSE endpoint forwards to subscribers. */
  payload?: unknown;
};

type Subscriber = (event: RealtimeEvent) => void;

const subscribers = new Set<Subscriber>();

const HEARTBEAT_MS = 15_000;

/** Register a listener; returns its unsubscribe function. */
export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Fan an event out to every connected client. Never throws. */
export function publish(event: Omit<RealtimeEvent, 'at'>): void {
  const payload: RealtimeEvent = { ...event, at: new Date().toISOString() };
  for (const subscriber of subscribers) {
    try {
      subscriber(payload);
    } catch {
      subscribers.delete(subscriber);
    }
  }
}

/** Shared SSE setup: headers, flush, heartbeat, and client-gone cleanup. */
export function initializeSseStream(res: Response): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      // Connection is gone; the close handler below does the cleanup.
    }
  }, HEARTBEAT_MS);

  const close = () => {
    clearInterval(heartbeat);
  };
  res.on('close', close);
  return close;
}

/** Test hook: drop every subscriber. */
export function resetSubscribers(): void {
  subscribers.clear();
}
