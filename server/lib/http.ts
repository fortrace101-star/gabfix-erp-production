import type { Response } from 'express';

/**
 * A request body that failed schema validation. Carries one message per field
 * so the API can answer 422 with details instead of dropping the input.
 */
export class ValidationError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

/** PostgreSQL unique-constraint violation. */
export const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === '23505';

/**
 * Uniform error response for a failed write: 422 with per-field details for
 * validation failures, 400 otherwise (unique violations get a friendlier
 * message than the raw driver text).
 */
export function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof ValidationError) return res.status(422).json({ error: 'Validation failed', fields: error.fields });
  if (isUniqueViolation(error)) return res.status(400).json({ error: 'A record with that number already exists' });
  return res.status(400).json({ error: error instanceof Error ? error.message : fallback });
}
