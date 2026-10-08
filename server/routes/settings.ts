import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { fail } from '../lib/http';
import { guard } from '../middleware/auth';
import { publish } from '../services/realtime';

/**
 * Server settings & feature flags (plan v5 B4) — owner/admin UI over the
 * settings singleton row (014). Channel credentials live in env; these flags
 * only gate dispatch (pickChannels).
 */

export const settingsRouter = Router();

const patchSchema = z
  .strictObject({
    company_name: z.string().trim().min(1).max(80).optional(),
    company_tagline: z.string().trim().max(160).optional(),
    company_phone: z.string().trim().max(30).optional(),
    company_address: z.string().trim().max(200).optional(),
    currency: z.string().trim().length(3).optional(),
    tax_basis: z.enum(['exclusive', 'inclusive']).optional(),
    whatsapp_enabled: z.boolean().optional(),
    sms_enabled: z.boolean().optional(),
    email_enabled: z.boolean().optional(),
    appreciation_delay_hours: z.number().int().min(0).max(168).optional(),
    feedback_retention_days: z.number().int().min(7).max(3650).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

async function readSettings() {
  const { rows } = await pool.query(
    `SELECT id, company_name AS "companyName", company_tagline AS "companyTagline",
            company_phone AS "companyPhone", company_address AS "companyAddress",
            currency, tax_basis AS "taxBasis",
            whatsapp_enabled AS "whatsappEnabled", sms_enabled AS "smsEnabled",
            email_enabled AS "emailEnabled",
            appreciation_delay_hours AS "appreciationDelayHours",
            feedback_retention_days AS "feedbackRetentionDays"
     FROM settings WHERE id = 1`,
  );
  return rows[0] ?? null;
}

/** GET /api/settings — the singleton row. */
settingsRouter.get('/', async (_req, res) => {
  try {
    const settings = await readSettings();
    if (!settings) {
      res.status(404).json({ error: 'Settings row missing (run migrations)' });
      return;
    }
    res.json(settings);
  } catch (error) {
    fail(res, error, 'Could not load settings');
  }
});

/** PATCH /api/settings — update flags/branding; change fans out over SSE. */
settingsRouter.patch('/', guard('owner', 'manager'), async (req, res) => {
  const parsed = patchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(422).json({ error: 'Invalid settings payload', details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 0;
  for (const [key, column] of Object.entries({
    company_name: 'company_name',
    company_tagline: 'company_tagline',
    company_phone: 'company_phone',
    company_address: 'company_address',
    currency: 'currency',
    tax_basis: 'tax_basis',
    whatsapp_enabled: 'whatsapp_enabled',
    sms_enabled: 'sms_enabled',
    email_enabled: 'email_enabled',
    appreciation_delay_hours: 'appreciation_delay_hours',
    feedback_retention_days: 'feedback_retention_days',
  })) {
    const value = body[key as keyof typeof body];
    if (value !== undefined) {
      i += 1;
      sets.push(`${column} = $${i}`);
      values.push(value);
    }
  }
  try {
    values.push(1);
    await pool.query(`UPDATE settings SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    const settings = await readSettings();
    res.json(settings);
    publish({ type: 'settings-updated' });
  } catch (error) {
    fail(res, error, 'Could not update settings');
  }
});
