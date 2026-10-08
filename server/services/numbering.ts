import type { PoolClient } from 'pg';

/**
 * Server-side document numbering (Phase 0.8, plan section 8.5).
 *
 * Each document family (jobs, invoices, laundry orders, and later payments
 * and journal entries) owns one row in `document_sequences`. The next value
 * is claimed with UPDATE ... RETURNING inside the same transaction as the
 * row insert, so two concurrent creates can never receive the same number —
 * unlike the retired client-side `JOB-${jobs.length + 143}` scheme, which
 * collided after any deletion or concurrent create.
 *
 * Numbers keep their legacy shapes: JOB-00145, INV-00099, LDY-00217.
 */

export type SequenceKey = 'job' | 'invoice' | 'laundry' | 'payment' | 'journal';

/**
 * Claim the next number for a sequence. Must run inside the caller's
 * transaction, before the document row is inserted. Throws when the
 * sequence row is missing so the failure names the key.
 */
export async function nextNumber(client: PoolClient, key: SequenceKey): Promise<string> {
  const { rows } = await client.query(
    `UPDATE document_sequences SET next_value = next_value + 1
     WHERE key = $1
     RETURNING prefix, width, next_value - 1 AS issued`,
    [key],
  );
  const sequence = rows[0] as { prefix: string; width: number; issued: number } | undefined;
  if (!sequence) throw new Error(`Unknown document sequence ${key}`);
  return `${sequence.prefix}-${String(sequence.issued).padStart(sequence.width, '0')}`;
}
