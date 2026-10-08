import type { Request } from 'express';
import { Router } from 'express';
import { authEnforced, requireAuth, requireScope } from '../middleware/auth';
import { initializeSseStream, subscribe, type RealtimeEvent } from '../services/realtime';

/**
 * GET /api/events — Server-Sent Events stream of workspace changes
 * (multi-app-plan §10.4: every app scope may listen).
 *
 * Auth note: EventSource cannot send an Authorization header, so a valid
 * access token may arrive as `?access_token=` (used by all four apps' SSE
 * clients). With enforcement on, both paths resolve through the same
 * scope check — the stream is the cross-app notification fabric.
 */
export const eventsRouter = Router();

eventsRouter.get('/', (req: Request, res, next) => {
  if (!req.headers.authorization) {
    const token = typeof req.query.access_token === 'string' ? req.query.access_token : '';
    if (token) req.headers.authorization = `Bearer ${token}`;
  }
  const check = requireScope('admin', 'laundry', 'portal', 'store');
  // requireAuth sets req.user; requireScope only *reads* it, so without this
  // chain every token-bearing SSE request 401s once enforcement is on.
  // Staged like guard(): pass-through until AUTH_ENFORCE=true.
  const authorize = (done: () => void): void => {
    if (!authEnforced()) return done();
    requireAuth(req, res, () => check(req, res, done));
  };
  authorize(() => {
    const unsubscribe = subscribe((event: RealtimeEvent) => {
      try {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        unsubscribe();
      }
    });

    initializeSseStream(res);
    req.on('close', unsubscribe);
  });
});
