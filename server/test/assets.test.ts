import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../validation/common';
import { equipmentResource } from '../validation/resources';
import { depreciateAssetInTx, nextPeriod } from '../services/assets';
import { pool } from '../db';
import { migrate } from '../migrate';

// ── Pure tests (no database) ───────────────────────────────────────────────

test('nextPeriod walks the calendar correctly across years', () => {
  assert.equal(nextPeriod('2026-09'), '2026-10');
  assert.equal(nextPeriod('2026-12'), '2027-01');
  assert.equal(nextPeriod('2026-01'), '2026-02');
});

test('equipment create accepts the asset register fields', () => {
  const parsed = parseBody(equipmentResource.create, {
    name: 'Washer 3',
    serialNumber: 'WM-003',
    value: '4500000',
    purchaseDate: '2026-03-15',
    salvageValue: '500000',
    usefulLifeMonths: '48',
    depreciationMethod: 'straight-line',
  }) as { salvageValue: number; usefulLifeMonths: number };
  assert.equal(parsed.salvageValue, 500000);
  assert.equal(parsed.usefulLifeMonths, 48);
  assert.throws(() =>
    parseBody(equipmentResource.create, { name: 'X', serialNumber: 'S', value: 1, usefulLifeMonths: '0' }),
  );
  assert.throws(() =>
    parseBody(equipmentResource.create, { name: 'X', serialNumber: 'S', value: 1, depreciationMethod: 'declining' }),
  );
});

// ── Integration tests (real PostgreSQL; skipped when unreachable) ──────────

const dbUp = await pool
  .query('SELECT 1')
  .then(() => true)
  .catch(() => false);

if (dbUp) {
  const client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }

  test('depreciation posts schedule, journal and book value together; the schedule cannot double-post', { timeout: 20_000 }, async () => {
    const run = Date.now();
    const assetId = `a-depr-${run}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO equipment (id, name, serial_number, next_maintenance, value, book_value,
                                purchase_date, cost, salvage_value, useful_life_months)
         VALUES ($1, 'Depreciable Washer', $2, '2026-12-01', 4500000, 4500000,
                 '2026-01-01', 4500000, 500000, 40)`,
        [assetId, `WM-DEPR-${run}`],
      );

      // First posting: (4500000 − 500000) / 40 = 100000 per month. The
      // schedule starts at the purchase month when it is empty.
      const first = await depreciateAssetInTx(client, assetId, null);
      assert.equal(first.period, '2026-01');
      assert.equal(first.amount, 100000);
      assert.equal(first.accumulated, 100000);
      assert.equal(first.bookValue, 4400000);
      assert.ok(first.journalNumber?.startsWith('JNL-'), 'posting writes a journal entry');

      // The entry is balanced: debit 6100, credit 1500.
      const entry = await client.query<{ id: string }>(`SELECT id FROM journal_entries WHERE number = $1`, [
        first.journalNumber,
      ]);
      const entryLines = await client.query<{ account_code: string; debit: number; credit: number }>(
        `SELECT account_code, debit::float8 AS debit, credit::float8 AS credit
         FROM journal_lines WHERE entry_id = $1 ORDER BY account_code`,
        [entry.rows[0].id],
      );
      assert.equal(entryLines.rows.length, 2);
      assert.deepEqual(entryLines.rows.map((row) => row.account_code), ['1500', '6100']);
      const debits = entryLines.rows.reduce((sum, row) => sum + row.debit, 0);
      const credits = entryLines.rows.reduce((sum, row) => sum + row.credit, 0);
      assert.equal(debits, 100000);
      assert.equal(credits, 100000);

      // Second posting continues at the next period and compounds.
      const second = await depreciateAssetInTx(client, assetId, null);
      assert.equal(second.period, '2026-02');
      assert.equal(second.accumulated, 200000);
      assert.equal(second.bookValue, 4300000);

      // The unique (equipment_id, period) index is the second line of
      // defence: the same period can never carry two postings. The probe
      // fails inside the test's transaction, so wrap it in a savepoint to
      // keep the rest of the test runnable.
      await client.query('SAVEPOINT ux_period_check');
      await assert.rejects(
        client.query(
          `INSERT INTO asset_depreciation_entries (equipment_id, period, amount, accumulated, book_value)
           VALUES ($1, '2026-01', 100000, 100000, 4400000)`,
          [assetId],
        ),
        /duplicate key|unique/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT ux_period_check');

      // Depreciate to the end of the schedule: 38 more months × 100000.
      for (let month = 0; month < 38; month += 1) {
        await depreciateAssetInTx(client, assetId, null);
      }
      const finalRow = await client.query<{ accumulated: number; book_value: number }>(
        `SELECT accumulated::float8 AS accumulated, book_value::float8 AS book_value
         FROM asset_depreciation_entries WHERE equipment_id = $1 ORDER BY period DESC LIMIT 1`,
        [assetId],
      );
      assert.equal(finalRow.rows[0].accumulated, 4000000);
      assert.equal(finalRow.rows[0].book_value, 500000);
      const equipmentRow = await client.query<{ book_value: number }>(
        `SELECT book_value::float8 AS book_value FROM equipment WHERE id = $1`,
        [assetId],
      );
      assert.equal(equipmentRow.rows[0].book_value, 500000);

      // One month past the end: the schedule refuses, it never goes negative.
      await assert.rejects(depreciateAssetInTx(client, assetId, null), /fully depreciated/);

      // Disposal stops the schedule too.
      await client.query(`UPDATE equipment SET disposed_at = '2026-03-01' WHERE id = $1`, [assetId]);
      await assert.rejects(depreciateAssetInTx(client, assetId, null), /disposed/);

      // Deleting the asset cascades its schedule rows (journal entries stay —
      // the ledger is history, not a child of the asset).
      await client.query(`DELETE FROM equipment WHERE id = $1`, [assetId]);
      const leftovers = await client.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM asset_depreciation_entries WHERE equipment_id = $1`,
        [assetId],
      );
      assert.equal(leftovers.rows[0].n, '0');

      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
} else {
  test('assets integration skipped (no PostgreSQL reachable)', () => {
    console.warn('[assets.test] PostgreSQL unreachable — integration tests skipped');
  });
}
