import type { PoolClient } from 'pg';
import { pool } from '../db';
import { postJournalEntry } from './ledger';

/**
 * Asset depreciation (Phase 1 data spine).
 *
 * The schedule is the truth: one posting per asset per period
 * (asset_depreciation_entries), generated from the straight-line formula
 * (cost − salvage) / useful_life_months. Each posting debits depreciation
 * expense (6100) and credits accumulated depreciation (1500) through the
 * ledger service, then updates the equipment row — so accumulated
 * depreciation, book value and the journal always move together, like a
 * payment and its journal (plan section 15.4).
 *
 * Periods post in order: the first call after purchase starts at the
 * purchase month, later calls continue from the newest schedule row, and a
 * period can never post twice (UNIQUE (equipment_id, period) plus a FOR
 * UPDATE row lock on the asset). The schedule stops once accumulated
 * depreciation reaches cost − salvage.
 */

const DEPRECIATION_EXPENSE = '6100';
const ACCUMULATED_DEPRECIATION = '1500';

const rounded = (value: number) => Math.round(value * 100) / 100;

/** '2026-09' + 1 → '2026-10'; '2026-12' + 1 → '2027-01'. */
export function nextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${String(next.year).padStart(4, '0')}-${String(next.month).padStart(2, '0')}`;
}

export type DepreciateResult = {
  equipmentId: string;
  period: string;
  amount: number;
  accumulated: number;
  bookValue: number;
  journalNumber: string | null;
};

/** Post one month of depreciation for an asset. Runs in its own transaction. */
export async function depreciateAsset(equipmentId: string, postedBy: string | null): Promise<DepreciateResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await depreciateAssetInTx(client, equipmentId, postedBy);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Transaction body for a depreciation posting, composable like the other services. */
export async function depreciateAssetInTx(
  client: PoolClient,
  equipmentId: string,
  postedBy: string | null,
): Promise<DepreciateResult> {
  // Lock the asset row so two concurrent postings can never race a period.
  const { rows } = await client.query<{
    name: string;
    cost: number;
    salvage_value: number;
    useful_life_months: number | null;
    depreciation_method: string;
    accumulated_depreciation: number;
    purchase_date: string | null;
    disposed_at: string | null;
  }>(
    `SELECT name, cost::float8 AS cost, salvage_value::float8 AS salvage_value,
            useful_life_months, depreciation_method,
            accumulated_depreciation::float8 AS accumulated_depreciation,
            purchase_date::text AS purchase_date, disposed_at::text AS disposed_at
     FROM equipment WHERE id = $1 FOR UPDATE`,
    [equipmentId],
  );
  if (!rows.length) throw new Error('Asset not found');
  const asset = rows[0];
  if (asset.disposed_at) throw new Error('Asset is disposed');
  if (asset.depreciation_method === 'none') throw new Error('Asset does not depreciate');
  if (!asset.useful_life_months || asset.useful_life_months <= 0) {
    throw new Error('Asset has no useful life to depreciate over');
  }

  const depreciable = rounded(asset.cost - asset.salvage_value);
  const remaining = rounded(depreciable - asset.accumulated_depreciation);
  if (depreciable <= 0 || remaining <= 0) throw new Error('Asset is fully depreciated');

  // The schedule posts in order: the first month after the newest posting,
  // or the purchase month when the schedule is empty. Periods before the
  // purchase month cannot exist, so ordering holds by construction.
  const { rows: lastRows } = await client.query<{ period: string | null }>(
    `SELECT MAX(period) AS period FROM asset_depreciation_entries WHERE equipment_id = $1`,
    [equipmentId],
  );
  const last = lastRows[0]?.period ?? null;
  const period = last ? nextPeriod(last) : (asset.purchase_date ?? '').slice(0, 7);
  if (period.length !== 7) throw new Error('Asset has no purchase date to start the schedule from');

  // This period's charge: the straight-line month, capped at what remains.
  const amount = rounded(Math.min(remaining, depreciable / asset.useful_life_months));
  const accumulated = rounded(asset.accumulated_depreciation + amount);
  const bookValue = rounded(asset.cost - accumulated);

  // Debit depreciation expense, credit accumulated depreciation. A zero
  // amount would unbalance the entry, and postJournalEntry refuses it.
  const journal = await postJournalEntry(client, {
    memo: `Depreciation: ${asset.name} ${period}`,
    source: 'depreciation',
    sourceId: equipmentId,
    postedBy,
    lines: [
      { accountCode: DEPRECIATION_EXPENSE, debit: amount },
      { accountCode: ACCUMULATED_DEPRECIATION, credit: amount },
    ],
  });

  // The UNIQUE (equipment_id, period) constraint is the second defence after
  // the row lock: a lost race must abort the whole posting, journal included.
  await client.query(
    `INSERT INTO asset_depreciation_entries (equipment_id, period, amount, accumulated, book_value, posted_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [equipmentId, period, amount, accumulated, bookValue, postedBy],
  );
  await client.query(`UPDATE equipment SET accumulated_depreciation = $2, book_value = $3 WHERE id = $1`, [
    equipmentId,
    accumulated,
    bookValue,
  ]);

  return { equipmentId, period, amount, accumulated, bookValue, journalNumber: journal.number };
}
