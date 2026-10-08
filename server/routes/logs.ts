import { Router } from 'express';
import { queryLogs, getRecent, type LogFilter } from '../services/log-store';
import { requireScope } from '../middleware/auth';

export const logsRouter = Router();

/**
 * GET /api/logs
 *
 * Returns a filtered, paginated list of request logs from the in-memory
 * ring buffer (falls back to file persistence when the buffer is cold).
 * Admin-console-only endpoint.
 *
 * Query params:
 *   limit      — max entries (default 100, max 200)
 *   appId      — filter by app ID (admin | laundry | portal | store)
 *   method     — filter by HTTP method
 *   statusMin  — minimum status code
 *   statusMax  — maximum status code
 *   from       — ISO date string
 *   to         — ISO date string
 *   search     — free-text search on URL
 */
logsRouter.get(
  '/',
  requireScope('admin'),
  (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const filter: LogFilter = {
      appId: req.query.appId as string | undefined,
      method: req.query.method as string | undefined,
      statusMin: req.query.statusMin ? Number(req.query.statusMin) : undefined,
      statusMax: req.query.statusMax ? Number(req.query.statusMax) : undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      search: req.query.search as string | undefined,
    };

    const logs = Object.keys(filter).some((k) => filter[k as keyof LogFilter] !== undefined)
      ? queryLogs(filter, limit)
      : getRecent(limit);

    res.json(logs);
  },
);
