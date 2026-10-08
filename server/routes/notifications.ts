import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db';
import { unreadNotifications, markNotificationRead, markAllNotificationsRead, recordFeedback, getFeedbackRequest, type BellScope } from '../services/notifications';
import { fail } from '../lib/http';

/**
 * Notification routes (Phase 3, plan §13; bells re-scoped in plan v5 F2).
 *
 * - GET  /api/notifications/unread              — bell panel data (scoped:
 *   ?scope=admin|laundry|portal|store, ?employeeId=, ?customerId=, ?since=)
 * - GET  /api/notifications/unread/:customerId  — legacy customer-only bell
 * - POST /api/notifications/:id/read            — mark one notification read
 * - POST /api/notifications/read-all            — mark the whole bell read
 * - GET  /feedback/:token                        — public feedback form (HTML)
 * - POST /feedback/:token                        — record a star rating
 * - POST /api/webhooks/whatsapp                  — WhatsApp delivery status
 * - POST /api/webhooks/sms                       — SMS delivery status
 */
export const notificationsRouter = Router();

// ── Bell panel ─────────────────────────────────────────────────────────────────

const SCOPES: ReadonlySet<string> = new Set(['admin', 'laundry', 'portal', 'store']);

function bellOptions(req: Request): Parameters<typeof unreadNotifications>[1] {
  const scope = typeof req.query.scope === 'string' && SCOPES.has(req.query.scope) ? (req.query.scope as BellScope) : undefined;
  const employeeId = typeof req.query.employeeId === 'string' ? req.query.employeeId : undefined;
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : '';
  const since = typeof req.query.since === 'string' ? req.query.since : undefined;
  const limit = Number(req.query.limit);
  return { scope, employeeId, since, limit: Number.isFinite(limit) ? limit : undefined, ...(customerId ? { customerId } : {}) } as Parameters<typeof unreadNotifications>[1];
}

notificationsRouter.get('/notifications/unread', async (req: Request, res: Response) => {
  try {
    const rows = await unreadNotifications('', bellOptions(req));
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load notifications');
  }
});

notificationsRouter.get('/notifications/unread/:customerId', async (req: Request, res: Response) => {
  try {
    const rows = await unreadNotifications(String(req.params.customerId));
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load notifications');
  }
});

notificationsRouter.post('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    const scope = typeof req.body?.scope === 'string' && SCOPES.has(req.body.scope) ? (req.body.scope as BellScope) : undefined;
    const employeeId = typeof req.body?.employeeId === 'string' ? req.body.employeeId : undefined;
    const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : undefined;
    const updated = await markAllNotificationsRead({ scope, employeeId, customerId });
    res.json({ updated });
  } catch (error) {
    fail(res, error, 'Could not mark notifications read');
  }
});

notificationsRouter.post('/notifications/:id/read', async (req: Request, res: Response) => {
  try {
    const ok = await markNotificationRead(String(req.params.id));
    res.json({ marked: ok });
  } catch (error) {
    fail(res, error, 'Could not mark notification');
  }
});

// ── Webhooks (delivery status ingestion, plan §13.1 step 5) ──────────────────

notificationsRouter.post('/webhooks/whatsapp', async (req: Request, res: Response) => {
  const entry = (req.body as { entry?: unknown[] })?.entry ?? [];
  const statuses = (entry.flatMap((e: any) =>
    e?.changes?.flatMap((c: any) => c?.value?.statuses ?? []) ?? [],
  ) ?? []) as Array<{ id: string; status: string }>;
  for (const s of statuses) {
    try {
      await pool.query(
        `UPDATE notifications SET status = $1, ${s.status === 'read' ? 'read_at = NOW()' : 'sent_at = COALESCE(sent_at, NOW())'} WHERE provider_ref = $2`,
        [s.status === 'read' ? 'read' : s.status === 'delivered' ? 'delivered' : 'sent', s.id],
      );
    } catch {
      // Individual webhook status updates are best-effort.
    }
  }
  res.json({ received: statuses.length });
});

notificationsRouter.post('/webhooks/sms', async (req: Request, res: Response) => {
  const smsData = (req.body as { SMSMessageData?: { Recipients?: unknown[] } })?.SMSMessageData;
  const recipients = (smsData?.Recipients ?? []) as Array<{ messageId: string; status: string }>;
  for (const r of recipients) {
    try {
      await pool.query(
        `UPDATE notifications SET status = $1 WHERE provider_ref = $2`,
        [r.status === 'Sent' ? 'sent' : r.status === 'Delivered' ? 'delivered' : r.status === 'Failed' ? 'failed' : 'sent', r.messageId],
      );
    } catch {
      // Individual webhook status updates are best-effort.
    }
  }
  res.json({ received: recipients.length });
});

// ── Public feedback form (plan §13.4) ────────────────────────────────────────

notificationsRouter.get('/feedback/:token', async (req: Request, res: Response) => {
  const request = await getFeedbackRequest(String(req.params.token));
  if (!request) {
    res.status(404).send('<html><body><h1>Feedback link not valid</h1><p>This link has expired or been used.</p></body></html>');
    return;
  }
  if (request.used_at) {
    res.status(410).send('<html><body><h1>Feedback already submitted</h1><p>Thank you for your rating.</p></body></html>');
    return;
  }

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gabfix feedback</title>
<style>
body{font-family:sans-serif;max-width:480px;margin:40px auto;padding:0 16px;text-align:center}
.stars{display:inline-flex;gap:4px}
.star{width:32px;height:32px;border:none;background:none;font-size:28px;color:#e5e7eb;cursor:pointer}
.star.selected{color:#eab308}
textarea{width:100%;margin-top:12px;padding:8px;border:1px solid #d1d5db;border-radius:6px}
</style></head>
<body>
<h1>How was your service?</h1>
<p>We'd appreciate your feedback.</p>
<form method="POST" action="/feedback/${request.token}">
<input type="hidden" name="rating" id="rating" value="">
<div class="stars">${[1, 2, 3, 4, 5].map((n) => `<span class="star" data-star="${n}">★</span>`).join('')}</div>
<textarea name="comment" placeholder="Optional comments (max 500 characters)" maxlength="500" rows="3"></textarea>
<button type="submit" style="margin-top:16px;padding:10px 24px;font-size:16px;border:none;border-radius:6px;background:#111827;color:#fff;cursor:pointer">Submit</button>
</form>
<script>
document.querySelectorAll('.star').forEach(s => s.addEventListener('click', () => {
  document.querySelectorAll('.star').forEach(x => x.classList.remove('selected'));
  let curr = s; while (curr) { curr.classList.add('selected'); curr = curr.nextElementSibling; }
  document.getElementById('rating').value = s.dataset.star;
}));
</script>
</body>
</html>`);
});

notificationsRouter.post('/feedback/:token', async (req: Request, res: Response) => {
  const rating = Number(req.body?.rating);
  const comment = String(req.body?.comment ?? '').slice(0, 500);
  if (!(rating >= 1 && rating <= 5)) {
    res.status(400).send('<html><body><h1>Invalid rating</h1><p>Please select 1 to 5 stars.</p></body></html>');
    return;
  }
  const ok = await recordFeedback(String(req.params.token), rating, comment);
  if (!ok) {
    res.status(404).send('<html><body><h1>Feedback link not valid</h1><p>This link has expired or been used.</p></body></html>');
    return;
  }
  res.send('<html><body><h1>Thank you!</h1><p>Your feedback has been recorded. Thank you for choosing Gabfix.</p></body></html>');
});