import { Router } from 'express';
import { getData } from '../repositories/workspace';

export const workspaceRouter = Router();

/** Full workspace snapshot — every screen still reads from this until 0.11 scopes it. */
workspaceRouter.get('/', async (_req, res) => {
  try {
    res.json(await getData());
  } catch (error) {
    console.error('GET /api/data failed:', error);
    res.status(500).json({ error: 'Failed to load data' });
  }
});
