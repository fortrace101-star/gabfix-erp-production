import type { PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';
import { nextNumber } from './numbering';
import { kampalaToday } from '../lib/dates';

/**
 * Double-entry ledger (Phase 1 data spine).
 *
 * postJournalEntry() writes one entry + its lines inside the caller's
 * transaction and refuses to post an unbalanced entry, so `sum(debit) =
 * sum(credit)` holds for every entry in the journal (the invariant the plan
 * assigns to the ledger service). Callers compose this with their document
 * insert — a payment and its journal posting commit together or not at all.
 */

export type JournalLineInput = {
  accountCode: string;
  debit?: number;
  credit?: number;
  customerId?: string | null;
  jobId?: string | null;
  employeeId?: string | null;
};

const rounded = (value: number) => Math.round(value * 100) / 100;

/** Post one balanced journal entry; must run inside the caller's transaction. */
export async function postJournalEntry(
  client: PoolClient,
  input: {
    date?: string;
    memo?: string;
    source: string;
    sourceId?: string | null;
    postedBy?: string | null;
    lines: JournalLineInput[];
  },
): Promise<{ id: string; number: string }> {
  const lines = input.lines.map(line => ({
    accountCode: line.accountCode,
    debit: rounded(line.debit ?? 0),
    credit: rounded(line.credit ?? 0),
    customerId: line.customerId ?? null,
    jobId: line.jobId ?? null,
    employeeId: line.employeeId ?? null,
  })).filter(line => line.debit !== 0 || line.credit !== 0);

  if (lines.length < 2) throw new Error('A journal entry needs at least two non-zero lines');
  const debits = rounded(lines.reduce((sum, line) => sum + line.debit, 0));
  const credits = rounded(lines.reduce((sum, line) => sum + line.credit, 0));
  if (debits === 0 || debits !== credits) {
    throw new Error(`Unbalanced journal entry: debits ${debits} != credits ${credits}`);
  }

  const number = await nextNumber(client, 'journal');
  // Ids are minted in code like every other table (j…, e…, c…); the random
  // suffix keeps same-millisecond entries from colliding.
  const entryId = `jrnl${Date.now()}${randomBytes(3).toString('hex')}`;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (id, number, date, memo, source, source_id, posted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [entryId, number, input.date ?? kampalaToday(), input.memo ?? '', input.source, input.sourceId ?? null, input.postedBy ?? null],
  );

  for (const line of lines) {
    await client.query(
      `INSERT INTO journal_lines (entry_id, account_code, debit, credit, customer_id, job_id, employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entryId, line.accountCode, line.debit, line.credit, line.customerId, line.jobId, line.employeeId],
    );
  }
  return { id: entryId, number };
}
