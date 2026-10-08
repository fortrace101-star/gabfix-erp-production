import { Router } from 'express';
import { createHandler, updateHandler } from './handlers';
import { jobsResource } from '../validation/resources';
import { pool } from '../db';
import { dispatchEvent } from '../services/notifications';
import { publish } from '../services/realtime';

export const jobsRouter = Router();

/** POST /api/jobs — server-side JOB-NNNNN numbering via document_sequences. */
jobsRouter.post('/', createHandler(jobsResource, { idPrefix: 'j', sequenceKey: 'job' }));

/** PATCH /api/jobs/:id — status, assignees, equipment usage, revenue, cost.
 *  Emits a `job-updated` event on every PATCH that carries a `status`, so the
 *  portal's PATCH /api/jobs/:id/status drives live updates in the admin console
 *  (dashboard counters, RequestLogs timeline) over the shared /api/events feed.
 */
jobsRouter.patch('/:id', updateHandler(jobsResource, {
  notFound: 'Job not found',
  label: 'job update',
  afterUpdate: async ({ id, body }) => {
    if (body.status === 'Completed') {
      const client = await pool.connect();
      try {
        await dispatchEvent(client, { type: 'job.completed', entityType: 'jobs', entityId: id });
      } finally {
        client.release();
      }
    }
    // Cross-app live update (portal → admin + portal self-feed):
    publish({ type: 'job-updated', payload: { id, status: body.status } });
  },
}));
