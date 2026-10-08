import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { parseBody } from '../validation/common';
import webpush from 'web-push';
import { verifyToken } from '../middleware/auth';
import type { AuthUser } from '../middleware/auth';

export const pushRouter = Router();

const subscriptionCreate = z.object({
  app_id: z.string().min(1),
  employee_id: z.string().uuid().optional(),
  device_id: z.string().min(1),
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

const subscriptionPatch = z
  .strictObject({
    device_id: z.string().min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

pushRouter.post('/', async (req: Request, res: Response) => {
  const input = parseBody(subscriptionCreate, req.body);
  try {
    const values = [
      input.app_id,
      input.employee_id ?? '',
      input.device_id,
      input.endpoint,
      input.p256dh,
      input.auth,
    ];
    await pool.query(
      `INSERT INTO push_subscriptions (app_id, employee_id, device_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (app_id, device_id) DO UPDATE SET
         endpoint = EXCLUDED.endpoint,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         active = TRUE,
         updated_at = now()`,
      values,
    );
    res.status(201).json({ ok: true, app_id: input.app_id, device_id: input.device_id });
  } catch (error) {
    fail(res, error, 'Could not store push subscription');
  }
});

pushRouter.delete('/', async (req: Request, res: Response) => {
  const input = parseBody(
    z.object({ app_id: z.string().min(1), device_id: z.string().min(1) }),
    req.body,
  ) as { app_id: string; device_id: string };
  try {
    const { rowCount } = await pool.query(
      `UPDATE push_subscriptions SET active = FALSE, updated_at = now()
       WHERE app_id = $1 AND device_id = $2`,
      [input.app_id, input.device_id],
    );
    res.json({ ok: rowCount ? true : false });
  } catch (error) {
    fail(res, error, 'Could not delete push subscription');
  }
});

pushRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT app_id, device_id, endpoint, active, created_at, updated_at
       FROM push_subscriptions
       ORDER BY updated_at DESC LIMIT 200`,
    );
    res.json(rows);
  } catch (error) {
    fail(res, error, 'Could not load push subscriptions');
  }
});

const sendInternal = z.object({
  app_id: z.string().min(1),
  device_id: z.string().min(1).optional(),
  endpoint: z.string().url().optional(),
  p256dh: z.string().min(1).optional(),
  auth: z.string().min(1).optional(),
  payload: z.record(z.string(), z.string()).optional(),
});

/** Internal POST /api/push/send — used by the scheduler and internal admin
 *  dispatch (Phase 3.5) to send a push notification to a specific device.
 *  Requires the raw Authorization header to promote to a user; the app_id
 *  must match the subscribing app. The recipient device is looked up by
 *  app_id (+ device_id if supplied). */
pushRouter.post('/send', async (req: Request, res: Response) => {
  // Raw-auth promotion: the scheduler and admin routes may call this
  // endpoint without a full session. Promote the raw Authorization token
  // to a user record; if none, allow a no-auth internal call (scheduler).
  const auth = (req.headers as unknown as Record<string, string | string[]>).authorization;
  const token = typeof auth === 'string' ? auth : (auth as string[] | undefined)?.[0] ?? '';
  if (token) {
      try {
        const user = verifyToken(token, 'access');
        if (!user) {
          return fail(res, 'Invalid access token', 'Invalid access token');
        }
        (req as Request & { user: AuthUser }).user = user;
      } catch {
        return fail(res, 'Invalid access token', 'Invalid access token');
      }
    }

  const input = parseBody(sendInternal, req.body);
  const payload = input.payload ?? {
    app_id: input.app_id,
    device_id: input.device_id ?? 'unknown',
    sent_at: new Date().toISOString(),
  };

  try {
    // Resolve the active subscription for the target device.
    let where = `app_id = $1 AND active = TRUE`;
    const values: string[] = [input.app_id];
    let paramIndex = 1;
    if (input.device_id) {
      paramIndex += 1;
      where += ` AND device_id = $${paramIndex}`;
      values.push(input.device_id);
    }
    const { rows } = await pool.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions
       WHERE ${where}`,
      values,
    );
    if (!rows.length) {
      return fail(res, 'No active push subscription for target device', 'No active push subscription for target device');
    }

    const subscription = rows[0];
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return fail(res, 'VAPID keys not configured', 'VAPID keys not configured');
    }
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'admin@gabfix.local'}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    const options = {
      TTL: 24 * 60 * 60, // 24h delivery window
      subject: 'mailto:admin@gabfix.local',
    };
    await webpush.sendNotification(subscription, JSON.stringify(payload), options);
    res.json({ ok: true, endpoint: subscription.endpoint, sent: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('404') || message.includes('Not Found') || message.includes('Unsubscription')) {
      return fail(res, 'Subscription no longer valid', 'Subscription no longer valid');
    }
    fail(res, error, 'Push send failed');
  }
});

export default pushRouter;
