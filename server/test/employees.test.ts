import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCOPE_DOMAIN } from '../routes/employees';
import { pool } from '../db';
import { migrate } from '../migrate';

// ── Integration tests (real PostgreSQL; skipped when unreachable) ────────────
// The router enforces role checks via guard(); with AUTH_ENFORCE unset those
// pass through, so these exercise the SQL and the last-owner protections.

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

  test('creating a storekeeper with a store scope round-trips through employees', { timeout: 20_000 }, async () => {
    const { rows } = await client.query(
      `INSERT INTO employees (name, role, phone, app_scope, active)
       VALUES ('Test Storekeeper', 'storekeeper', '+256 700 000 001', ARRAY['store']::TEXT[], TRUE)
       RETURNING id, name, role, app_scope`,
    );
    const emp = rows[0];
    assert.equal(emp.role, 'storekeeper');
    assert.deepEqual(emp.app_scope, ['store']);

    // Scope grant → revoke cycle (the B6 acceptance path)
    const granted = await client.query(
      `UPDATE employees SET app_scope = $2 WHERE id = $1 RETURNING app_scope`,
      [emp.id, ['store', 'portal']],
    );
    assert.deepEqual(granted.rows[0].app_scope, ['store', 'portal']);

    const revoked = await client.query(
      `UPDATE employees SET app_scope = $2 WHERE id = $1 RETURNING app_scope`,
      [emp.id, ['portal']],
    );
    assert.deepEqual(revoked.rows[0].app_scope, ['portal']);

    // Clean up
    await client.query(`DELETE FROM employees WHERE id = $1`, [emp.id]);
  });

  test('app_scope rejects values outside the four apps', { timeout: 20_000 }, async () => {
    await assert.rejects(
      client.query(
        `INSERT INTO employees (name, role, app_scope) VALUES ('Bad Scope', 'technician', ARRAY['tiktok']::TEXT[])`,
      ),
      /app_scope/,
    );
  });

  test('exactly one active owner exists (005 partial unique index)', { timeout: 20_000 }, async () => {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM employees WHERE role = 'owner' AND active AND deleted_at IS NULL`,
    );
    assert.equal(rows[0].n, 1);
  });

  test('SCOPE_DOMAIN lists the four apps in canonical order', () => {
    assert.deepEqual([...SCOPE_DOMAIN], ['admin', 'laundry', 'portal', 'store']);
  });
}
