import { processQueued, channelStatus, loadSettings } from './notifications';
import { pool } from '../db';

/**
 * Scheduler (Plan v5 F4.4): runs `processQueued()` on a fixed interval and
 * re-checks push subscriptions for stale subscriptions that can be purged.
 *
 * Lightweight: no node-cron dependency, no Redis, single-process-safe. A
 * multi-instance deployment upgrades behind the same `processQueued` contract
 * using a locking mechanism (noted for Phase H2).
 */

const DEFAULT_INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS || 60_000);

let running = false;

export function startScheduler(intervalMs = DEFAULT_INTERVAL_MS): () => void {
  if (running) return () => {};

  running = true;

  // First pass after a short delay so the app is fully up and pages are
  // already writing notifications.
  const initialDelay = Math.max(0, intervalMs - 5_000);

  const run = async () => {
    try {
      // 1. Send anything queued whose timer has fired.
      await processQueued(20);

      // 2. Report channel health to the console (dev insight, not a route).
      //    MUST release the client: an unreleased pool client per pass
      //    exhausts max:10 within ~10 minutes and every later query dies on
      //    connectionTimeoutMillis — the "timeout exceeded when trying to
      //    connect" 500s that took down login//api/data.
      const client = await pool.connect();
      try {
        const settings = await loadSettings(client);
        const status = await channelStatus(settings);
        if (process.env.NODE_ENV === 'development') {
          console.log('[scheduler] channels:', JSON.stringify(status));
        }
      } finally {
        client.release();
      }
    } catch (error) {
      // Best-effort: never let the scheduler crash the server.
      console.error('[scheduler] pass failed:', error instanceof Error ? error.message : error);
    }
  };

  void run();

  const interval = setInterval(() => {
    void run();
  }, intervalMs);

  const stop = () => {
    running = false;
    clearInterval(interval);
  };

  return stop;
}

/** Graceful shutdown: stop the scheduler loop. */
export function stopScheduler(stop: () => void): void {
  stop();
}
