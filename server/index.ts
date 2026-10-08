import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ensureDatabase } from './bootstrap-db';
import { databaseName } from './db-config';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { customersRouter } from './routes/customers';
import { equipmentRouter } from './routes/equipment';
import { expensesRouter } from './routes/expenses';
import { inventoryRouter } from './routes/inventory';
import { jobsRouter } from './routes/jobs';
import { paymentsRouter } from './routes/payments';
import { costingRouter } from './routes/costing';
import { assetsRouter } from './routes/assets';
import { laundryRouter } from './routes/laundry';
import { documentsRouter } from './routes/documents';
import { servicesRouter } from './routes/services';
import { eventsRouter } from './routes/events';
import { logsRouter } from './routes/logs';
import { workspaceRouter } from './routes/workspace';
import { notificationsRouter } from './routes/notifications';
import { telemetryRouter } from './routes/telemetry';
import { employeesRouter } from './routes/employees';
import { invitesRouter } from './routes/invites';
import { settingsRouter } from './routes/settings';
import { storeRouter } from './routes/store';
import { devicesRouter } from './routes/devices';
import { syncRouter } from './routes/sync';
import { jobStatusRouter } from './routes/job-status';
import { crmRouter } from './routes/crm';
import { pushRouter } from './routes/push';
import { assignmentsRouter, assignableEmployeesRouter } from './routes/assignments';
import { jobChecklistRouter } from './routes/job-checklist';
import { ordersRouter, proposalRouter } from './routes/orders';
import { router as permissionMatrixRouter } from './routes/permission-matrix';
import type { Request, Response, NextFunction } from 'express';
import { guard, requireScope, type AuthUser, verifyToken } from './middleware/auth';
import { startScheduler } from './services/scheduler';

import { requestLogger } from './middleware/requestLogger';
import { appendLog, type RequestLog } from './services/log-store';
import { publish } from './services/realtime';
import { randomUUID } from 'node:crypto';
import webpush from 'web-push';

// Multi-app CORS (multi-app-plan §10.3): the four Vercel apps plus local dev
// ports 5173–5179. Vite serves on IPv6 localhost in dev, hence the ::1 forms.
const ALLOWED_ORIGINS = [
  'https://gabfix-erp-production-six.vercel.app',
  'https://gabfix-laundry-front-office.vercel.app',
  'https://gabfix-inhouse-erp.vercel.app',
  'https://gabfix-store.vercel.app',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5174', 'http://127.0.0.1:5174',
  'http://localhost:5175', 'http://127.0.0.1:5175',
  'http://localhost:5176', 'http://127.0.0.1:5176',
  'http://localhost:5177', 'http://localhost:5178', 'http://localhost:5179',
  // Portal dev (Lovable sandbox) binds 8080+ instead of 5175 — keep its
  // invite-code sign-up / login fetches reachable during local development.
  'http://localhost:8080', 'http://127.0.0.1:8080',
  'http://localhost:8081', 'http://127.0.0.1:8081',
];

const app = express();
app.use(cors({
  origin(origin, callback) {
    // No Origin (curl, same-origin) or an allowlisted origin passes.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Dev override for preview servers etc., documented in .env.example.
    if (process.env.CORS_ALLOW_ALL === 'true') return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// Request logger: capture every request after it completes, store in ring
// buffer, and publish to SSE subscribers so the admin console gets a live feed.
app.use(requestLogger());

// Health stays unauthenticated (also exempted inside guard()).
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: databaseName });
});

// Auth endpoints manage their own tokens (login/refresh are public, /me calls
// requireAuth), so they mount before the staged guard.
app.use('/api/auth', authRouter);

// SSE mounts before the guard too: EventSource cannot send an Authorization
// header, so the router itself promotes ?access_token= and then runs the same
// requireAuth + requireScope chain — a query-only token would otherwise 401
// at guard() before the promotion ever runs.
app.use('/api/events', eventsRouter);

// Staged enforcement: a no-op until AUTH_ENFORCE=true, which Phase 0.10 flips
// once the login screen ships. Owner-only routes add guard('owner') on top.
app.use('/api', guard());

// Scoped mounts (multi-app-plan §10.4): each mount carries the app_scope set
// that may use it. Scope checks arm when AUTH_ENFORCE=true — mirroring guard(),
// they stay pass-through in the default dev posture.
const scoped = requireScope;

app.use('/api/data', scoped('admin', 'laundry', 'portal', 'store'), workspaceRouter);
app.use('/api/customers', scoped('admin', 'laundry', 'portal', 'store'), customersRouter);
app.use('/api/jobs', scoped('admin', 'portal', 'laundry'), jobsRouter);
// Role-dashboard writes (leads / follow-ups / interactions) — portal + admin.
app.use('/api/crm', scoped('admin', 'laundry', 'portal', 'store'), crmRouter);
app.use('/api/jobs', scoped('admin', 'portal'), jobStatusRouter); // :id/status lifecycle (D2)
app.use('/api/jobs', scoped('admin', 'portal'), assignmentsRouter); // :id/assignments crew (F3)
app.use('/api/jobs', scoped('admin', 'portal'), jobChecklistRouter); // :id/checklist + :id/activities (025)
// Order lifecycle (plan P1): propose / share / confirm / cancel / close.
app.use('/api/orders', scoped('admin', 'portal'), ordersRouter);
app.use('/api/payments', scoped('admin', 'laundry', 'store', 'portal'), paymentsRouter);
app.use('/api', scoped('admin', 'portal'), costingRouter); // /costs, /timesheets (Phase 1c)
app.use('/api/equipment', scoped('admin', 'laundry'), equipmentRouter);
app.use('/api/assets', scoped('admin'), assetsRouter); // /:id/depreciate (Phase 1d)
app.use('/api/laundry', scoped('admin', 'laundry', 'store', 'portal'), laundryRouter); // intake + status (Phase 1e)
app.use('/api/documents', scoped('admin', 'laundry', 'store', 'portal'), documentsRouter); // :type/:id.pdf (Phase 2)
app.use('/api/expenses', scoped('admin', 'laundry', 'store', 'portal'), expensesRouter);
app.use('/api/services', scoped('admin', 'laundry', 'store', 'portal'), servicesRouter);
app.use('/api/inventory', scoped('admin', 'laundry', 'store'), inventoryRouter);
app.use('/api/logs', logsRouter);     // GET /api/logs — request log history (admin)
app.use('/api', adminRouter); // POST /api/import, POST /api/reset (owner-only inside)

// Notification routes (Phase 3): bell panel + public feedback form + webhooks.
// Feedback form is public (no auth); bell-panel reads are guarded by /api guard.
app.use('/api', scoped('admin', 'portal', 'laundry', 'store'), notificationsRouter);
app.use('/api', scoped('admin', 'portal', 'laundry', 'store'), telemetryRouter);
// Control plane (plan v5 B3/B4): employees & access management + server settings.
// Owner/manager checks live inside the routers (requireRole/guard('owner','manager')).
// The name-only assignable list mounts FIRST with its one specific path so
// every app can resolve crew pickers; the rich admin list keeps its guard.
app.use('/api/employees', scoped('admin', 'portal', 'laundry', 'store'), assignableEmployeesRouter);
app.use('/api/employees', scoped('admin'), employeesRouter);
// Invite codes (plan v5 B3): admin-issued, app-scoped, single-use onboarding tickets.
app.use('/api/invites', scoped('admin'), invitesRouter);
app.use('/api/settings', scoped('admin'), settingsRouter);
// Store operations (plan v5 E2–E5): movements, tools, purchase requests, utilities.
app.use('/api/store', scoped('admin', 'store'), storeRouter);
// Devices registry (plan §6.3): admin control plane for the beacon hardware.
app.use('/api/devices', scoped('admin'), devicesRouter);
// Offline sync (plan C1): laundry front office outbox drain + delta pull.
app.use('/api/sync', scoped('admin', 'laundry'), syncRouter);
// Feedback links are shared via email/WhatsApp — mount public routes outside guard.
app.use('/', notificationsRouter);

// Proposal share links are pasted into WhatsApp — same public posture (P1).
app.use('/', proposalRouter);

// Web Push (Plan v5 F): device registry + delivery from the scheduler.
// Mount before the staged guard so the pub/sub fan-out (push subscriptions)
// works even when enforcement is off; push endpoints enforce requireScope
// (app_id) inside their own handlers.
// Express 5's typed `app.use(path, fn)` overload requires a separately
// declared, fully typed request handler; an inline arrow whose parameters
// are annotated is untyped and does not satisfy the overload.
function promoteRawAuth(req: Request, _res: Response, next: NextFunction): void {
  const auth = (req.headers as unknown as Record<string, string | string[]>).authorization;
  const token = typeof auth === 'string' ? auth : (auth as string[] | undefined)?.[0] ?? '';
  if (token) {
    const user = verifyToken(token, 'access');
    if (user) {
      (req as Request & { user: AuthUser }).user = user;
    }
  }
  next();
}

function pushBoundary(_req: Request, _res: Response, next: NextFunction): void {
  app.use('/api/push', promoteRawAuth, pushRouter);
  next();
}

app.use('/api/push', pushBoundary);

// SSE keep-alive: EventSource cannot send Authorization, so the stream is
// mounted before guard() and promotes ?access_token= itself.


// VAPID keys are server-managed (plan §F4.4): install them once at startup so
// pushAdapter has valid signing details loaded before any subscription arrives.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  // NOTE: web-push.sign() returns a compact base64 string; the real VAPID
  // public key is the URL-safe base64 variant. We expose the raw key to the
  // client (with URL-safe re-encoding) so the SW can pass it to pushManager.
  const urlSafePublicKey = Buffer.from(
    process.env.VAPID_PUBLIC_KEY,
  ).toString('base64');
  console.log('[push] VAPID public key for the browser:\n  VITE_VAPID_PUBLIC_KEY=' + urlSafePublicKey);
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || 'admin@gabfix.local'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  console.log('[push] VAPID details installed (EBD35447-A50B-4D2B-B5E6-E7A1F68C2F41)');
} else if (process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PRIVATE_KEY) {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY incomplete — push delivery disabled until both are set');
}

// Error boundary — must be registered before the 404 fallthrough (below) so it
// also catches body-parser "entity.parse.failed" SyntaxErrors. Without it, an
// invalid JSON body makes Express emit a raw stack trace; here we return a
// clean 400 and log the offending route + raw body so the caller is identifiable.
app.use(((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const isParseError =
    err instanceof SyntaxError &&
    typeof (err as { type?: unknown }).type === 'string' &&
        (err as unknown as { type: string }).type === 'entity.parse.failed';
    if (isParseError) {
    const raw = String((err as { body?: unknown }).body ?? '').slice(0, 200);
    const appId = (req.headers['x-app-id'] as string) || 'unknown';
    console.warn(`[api] malformed JSON body on ${req.method} ${req.originalUrl} :: ${raw || '(empty)'}`);
    res.status(400).json({ error: 'Invalid JSON body', path: req.path });
    // A body-parse failure fires before requestLogger attaches its `finish`
    // listener, so without this the event never reaches /api/logs or SSE.
    // Record it (with the raw body) so the operator can identify the caller.
    try {
      const entry: RequestLog = {
        id: `badjson-${randomUUID()}`,
        timestamp: new Date().toISOString(),
        appId,
        method: req.method,
        url: req.originalUrl || req.url,
        status: 400,
        duration: 0,
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: (req.headers['user-agent'] as string) || '',
        body: raw,
      };
      appendLog(entry);
      publish({ type: 'request-log', by: appId, payload: entry });
    } catch {}
    return;
  }
  console.error('[api] unhandled error', err instanceof Error ? err.stack ?? err.message : String(err));
  res.status(500).json({ error: 'Internal server error' });
}) as import('express').ErrorRequestHandler);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const port = Number(process.env.PORT) || 5000;

async function main() {
  // Make sure the database, its schema and demo data exist before serving.
  try {
    await ensureDatabase();
  } catch (error) {
    console.error('Database bootstrap failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  app.listen(port,'0.0.0.0',() => {
    console.log(`Gabfix API listening on http://localhost:${port}`);
  });
}

void main();

// Scheduler (Plan v5 F4): process queued notifications + channel health.
// Started only after the server has finished booting so that `ensureDatabase`
// has run first (the scheduler's first pass polls notification rows).
let schedulerStop: (() => void) | null = null;

process.on('SIGINT', () => {
  console.log('[scheduler] stopping');
  if (schedulerStop) schedulerStop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[scheduler] stopping');
  if (schedulerStop) schedulerStop();
  process.exit(0);
});

async function bootScheduler(): Promise<void> {
  schedulerStop = startScheduler(Number(process.env.SCHEDULER_INTERVAL_MS || 60_000));
}

void bootScheduler();