import type { Request, Response } from 'express';
import { pool } from '../db';
import { insertRecord, updateRecord } from '../repositories/records';
import { fail } from '../lib/http';
import { parseBody } from '../validation/common';
import type { Resource, SequenceKey } from '../validation/resources';
import { nextNumber } from '../services/numbering';
import { publish } from '../services/realtime';

/** SSE event type for a resource's create/update, derived from its table name. */
function eventTypeFor(resource: Resource, action: 'created' | 'updated'): string {
  const singular: Record<string, string> = {
    jobs: 'job',
    customers: 'customer',
    expenses: 'expense',
    equipment: 'equipment',
    inventory_items: 'inventory',
  };
  const noun = singular[resource.table];
  // Tables without a live event type (invoices, laundry_orders) simply do not
  // broadcast yet — they have no write routes in this phase.
  return noun ? `${noun}-${action}` : '';
}

/** Everything a create handler needs beyond the resource schema. */
export type CreateOptions = {
  /** Primary-key prefix, e.g. `c` for customers. */
  idPrefix: string;
  /** Server-side defaults applied after validation (`date`, `usage`, ...). */
  prepare?: (data: Record<string, unknown>) => Record<string, unknown>;
  /**
   * When set, the handler claims a server-side document number (via
   * `document_sequences`) inside the same transaction as the row insert, so
   * concurrent creates never collide. The claimed number is stored in
   * `number` when the client did not supply one.
   */
  sequenceKey?: SequenceKey;
};

/**
 * POST handler: validates the body against the resource schema (unknown fields
 * become 422), inserts one row and answers 201 with its id.
 *
 * When `sequenceKey` is set the insert runs inside a transaction so the
 * document number is claimed atomically — the client no longer generates
 * `JOB-NNNNN` itself.
 */
export function createHandler(resource: Resource, options: CreateOptions) {
  return async (req: Request, res: Response) => {
    try {
      const parsed = parseBody(resource.create, req.body) as Record<string, unknown>;
      const data = options.prepare ? options.prepare(parsed) : parsed;
      const id = `${options.idPrefix}${Date.now()}`;

      if (options.sequenceKey) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          if (!data.number) {
            data.number = await nextNumber(client, options.sequenceKey);
          }
          await insertRecord(resource, data, id, client);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } else {
        await insertRecord(resource, data, id);
      }

      const body: { id: string; number?: string } = { id };
      if (data.number) body.number = data.number as string;
      res.status(201).json(body);

      // Broadcast after the response so the write path is never delayed.
      const type = eventTypeFor(resource, 'created');
      if (type) publish({ type: type as never, by: req.user?.name });
    } catch (error) {
      fail(res, error, `Invalid ${resource.label}`);
    }
  };
}

/** PATCH handler: validates the patch, updates one row, 404s for an unknown id. */
export function updateHandler(resource: Resource, options: {
  notFound: string;
  label: string;
  afterUpdate?: (data: { id: string; body: Record<string, unknown> }) => Promise<void> | void;
}) {
  return async (req: Request, res: Response) => {
    try {
      if (!resource.patch) throw new Error(`No update schema for ${resource.table}`);
      const parsed = parseBody(resource.patch, req.body) as Record<string, unknown>;
      // Express 5 types a route param as string | string[]; ids are never arrays.
      const id = String(req.params.id);
      const updated = await updateRecord(resource, id, parsed);
      if (!updated) return res.status(404).json({ error: options.notFound });
      res.json({ ok: true });

      const type = eventTypeFor(resource, 'updated');
      if (type) publish({ type: type as never, by: req.user?.name });

      // Phase-3 hook: dispatch domain events (e.g. job.completed → notifications).
      if (options.afterUpdate) {
        void options.afterUpdate({ id, body: parsed });
      }
    } catch (error) {
      fail(res, error, `Invalid ${options.label}`);
    }
  };
}
