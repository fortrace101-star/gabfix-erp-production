/**
 * Request logging middleware.
 *
 * Wraps every /api request after it completes: captures method, URL, status,
 * duration, app ID (from X-App-Id header), client IP, and user-agent. The log
 * entry is stored in the ring-buffer log store and published to SSE
 * subscribers so the admin console receives it in real time.
 *
 * Health checks (/api/health) are skipped to avoid noise.
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { appendLog, type RequestLog } from '../services/log-store';
import { publish } from '../services/realtime';

const SKIP_PATHS = new Set(['/api/health']);

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Arrival: log EVERY request (health checks included) the moment it
    // reaches the server — including requests that never finish, e.g. while
    // waiting on an exhausted DB pool. Without this a hung request leaves no
    // trace. The ring-buffer/SSE feed below still skips health checks.
    const url = req.originalUrl || req.url;
    const arrivalAppId = (req.headers['x-app-id'] as string) || '-';
    console.log(`[req] ${req.method} ${url} ${arrivalAppId} <- ${req.ip || req.socket.remoteAddress || '?'}`);

    if (SKIP_PATHS.has(req.path)) {
      next();
      return;
    }

    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const elapsedNs = Number(process.hrtime.bigint() - start);
      const duration = Math.round(elapsedNs / 1_000_000); // ms

      const log: RequestLog = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        appId: (req.headers['x-app-id'] as string) || 'unknown',
        method: req.method,
        url,
        status: res.statusCode,
        duration,
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || '',
        userId: req.user?.id,
      };

      appendLog(log);
      publish({ type: 'request-log', by: log.appId, payload: log });

      // Console line naming the app the request came from, e.g.:
      // [store] GET /api/inventory 200 12ms
      const line = `[${log.appId}] ${log.method} ${log.url} ${log.status} ${log.duration}ms`;
      if (res.statusCode >= 500) console.error(line);
      else if (res.statusCode >= 400) console.warn(line);
      else console.log(line);
    });

    next();
  };
}
