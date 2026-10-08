import type { Request, Response } from 'express';
import { Router } from 'express';
import { DOCUMENT_TYPES, renderTypedDocument, type DocumentType } from '../services/pdf/documents';
import { fail } from '../lib/http';

/**
 * Document downloads (Phase 2, plan §12). Two shapes:
 *   GET /api/documents/:type/:id.pdf  — entity documents (invoice, receipt,
 *                                       laundry, job-card, statement,
 *                                       delivery-note, manifest)
 *   GET /api/documents/:type.pdf      — range/register documents (aging,
 *                                       assets, pl, balance-sheet with
 *                                       optional ?from=&to=)
 * Responses carry Content-Disposition attachment with the numbered filename
 * so "Save as" defaults to INV-00098.pdf; every render is mirrored into
 * DOCUMENT_STORAGE_DIR by the service so messaging can attach the same
 * bytes later.
 */
export const documentsRouter = Router();

const sendDocument = async (res: Response, type: DocumentType, id: string | null) => {
  const document = await renderTypedDocument(type, id);
  if (!document) return res.status(404).json({ error: 'Document not found' });
  res
    .status(200)
    .contentType('application/pdf')
    .setHeader('Content-Disposition', `attachment; filename="${document.filename}"`);
  res.send(document.buffer);
};

documentsRouter.get('/:type/:id.pdf', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as DocumentType;
    if (!DOCUMENT_TYPES.includes(type)) {
      return res.status(404).json({ error: `Unknown document type ${req.params.type}` });
    }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await sendDocument(res, type, id.replace(/\.pdf$/i, ''));
  } catch (error) {
    fail(res, error, 'Document render failed');
  }
});

documentsRouter.get('/:type.pdf', async (req: Request, res: Response) => {
  try {
    const type = req.params.type as DocumentType;
    if (!DOCUMENT_TYPES.includes(type)) {
      return res.status(404).json({ error: `Unknown document type ${req.params.type}` });
    }
    // pl takes an optional from/to pair as its reference.
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const ref = from && to ? `${from}/${to}` : null;
    await sendDocument(res, type, ref);
  } catch (error) {
    fail(res, error, 'Document render failed');
  }
});
