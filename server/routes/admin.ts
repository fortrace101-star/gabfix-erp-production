import { Router } from 'express';
import { pool } from '../db';
import { seedData } from '../seed-data';
import { replaceAll, truncateWorkspace } from '../repositories/records';
import { fail } from '../lib/http';
import { guard } from '../middleware/auth';
import { publish } from '../services/realtime';

/** Owner-only workspace maintenance: both endpoints wipe every managed table. */
export const adminRouter = Router();

/** POST /api/import — replace the whole workspace with a backup payload. */
adminRouter.post('/import', guard('owner'), async (req, res) => {
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await truncateWorkspace(client);
    await replaceAll(client, payload);
    await client.query('COMMIT');
    res.json({ ok: true });
    publish({ type: 'workspace-reset' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /api/import failed:', error);
    fail(res, error, 'Import failed');
  } finally {
    client.release();
  }
});

/** POST /api/reset — wipe the workspace and restore the original demo data. */
adminRouter.post('/reset', guard('owner'), async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await truncateWorkspace(client);
    await seedData(client);
    await client.query('COMMIT');
    res.json({ ok: true });
    publish({ type: 'workspace-reset' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /api/reset failed:', error);
    res.status(500).json({ error: 'Reset failed' });
  } finally {
    client.release();
  }
});
