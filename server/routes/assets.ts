import type { Request, Response } from 'express';
import { Router } from 'express';
import { depreciateAsset } from '../services/assets';
import { fail } from '../lib/http';
import { publish } from '../services/realtime';

/**
 * Asset register (Phase 1 data spine). One write for now — post the next
 * month of depreciation for an asset; the service generates the schedule row,
 * the journal entry and the book value together.
 */
export const assetsRouter = Router();

/** POST /api/assets/:id/depreciate */
assetsRouter.post('/:id/depreciate', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const assetId = Array.isArray(id) ? id[0] : id;
    const result = await depreciateAsset(assetId, req.user?.id ?? null);
    res.json(result);
    publish({ type: 'equipment-updated', by: req.user?.name });
  } catch (error) {
    fail(res, error, 'Depreciation failed');
  }
});
