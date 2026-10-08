import { z } from 'zod';
import { ValidationError } from '../lib/http';

/**
 * Shared zod primitives for request validation (Phase 0.7).
 *
 * Field names stay camelCase because that is what the client sends and what
 * `GET /api/data` returns; each resource maps them to snake_case columns with
 * an explicit column map (see resources.ts).
 */

/** Non-empty text. Values are trimmed, which also rejects whitespace-only input. */
export const text = z.string({ error: 'Required' }).trim().min(1, 'Required');

/** Optional text that may be empty (company, email, notes, ...). */
export const optionalText = z.string({ error: 'Must be text' }).trim();

/** Ids are TEXT keys such as `c1` or `JOB-00144`. */
export const idText = text;

/**
 * Money and quantities: numbers, or numeric strings straight from HTML inputs.
 * Preprocessing (rather than z.coerce) keeps `null` and `''` as errors instead
 * of quietly turning them into 0.
 */
export const money = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
  z
    .number({ error: (issue) => (issue.input === undefined ? 'Required' : 'Must be a number') })
    .finite()
    .nonnegative('Must be zero or more'),
);

/** Optional money/quantity. */
export const optionalMoney = money.optional();

/** ISO calendar date, e.g. 2026-09-25. */
export const dateText = z.string({ error: 'Required' }).trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Optional ISO calendar date. */
export const optionalDateText = dateText.optional();

/** A list of names, e.g. job assignees. */
export const optionalTextList = z.array(z.string().trim().min(1, 'Required')).optional();

/** `{ equipmentId, hours }` entries stored in jobs.equipment_usage (JSONB). */
export const optionalEquipmentUsage = z
  .array(z.strictObject({ equipmentId: idText, hours: money }))
  .optional();

/**
 * Parse a request body, raising a 422-ready ValidationError with one message
 * per offending field. Unknown fields are rejected, never silently dropped.
 */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  throw new ValidationError(fieldErrors(result.error));
}

/** Turn zod issues into `{ field: message }`, expanding unknown-key reports. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[key] = 'Unknown field';
      continue;
    }
    const path = issue.path.length ? issue.path.join('.') : '_';
    fields[path] = issue.message;
  }
  return fields;
}

/**
 * Map validated fields onto database columns using an explicit column map.
 * Every key must have a column: an unmapped key is a programmer error, so it
 * throws instead of disappearing (the defect Phase 0.7 removes).
 */
export function toColumnEntries(
  columns: Record<string, string>,
  data: Record<string, unknown>,
  jsonColumns: ReadonlySet<string> = new Set(),
): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const [field, value] of Object.entries(data)) {
    if (field === 'id' || value === undefined) continue;
    const column = columns[field];
    if (!column) throw new Error(`No column mapped for field ${field}`);
    entries.push([column, jsonColumns.has(column) ? JSON.stringify(value ?? []) : value]);
  }
  if (!entries.length) throw new Error('No fields to write');
  return entries;
}
