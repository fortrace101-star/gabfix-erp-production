import type { Request, Response } from 'express';
import { Router } from 'express';
import { parseBody } from '../validation/common';
import { paymentCreate } from '../validation/payments';
import { createPayment } from '../services/payments';
import { pool } from '../db';
import { dispatchEvent } from '../services/notifications';
import { fail } from '../lib/http';
import { publish } from '../services/realtime';

/**
 * Payments (Phase 1 data spine). Unlike the generic createHandler, a payment
 * create carries ledger and balance side effects, so it gets a custom
 * handler — but still broadcasts `payment-created` after the response so the
 * admin client refreshes like every other write. Phase 3: also dispatches
 * `payment.recorded` so a payment-receipt notification is queued.
 */
export const paymentsRouter = Router();

paymentsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const input = parseBody(paymentCreate, req.body);
    const result = await createPayment(input, req.user?.id ?? null);
    res.status(201).json(result);

    publish({ type: 'payment-created', by: req.user?.name });

    // Phase 3: queue a payment.recorded notification (receipt to the customer).
    const client = await pool.connect();
    try {
      await dispatchEvent(client, {
        type: 'payment.recorded',
        entityType: 'payments',
        entityId: result.id,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    fail(res, error, 'Invalid payment');
  }
});
