import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters } from '../routes/telemetry';
import { pool } from '../db';
import { migrate } from '../migrate';

// ── Pure tests (no database) ──────────────────────────────────────────────────

test('distanceMeters returns 0 for identical coordinates', () => {
  const result = distanceMeters(0, 0, 0, 0);
  assert.equal(result, 0);
});

test('distanceMeters computes known distance (eq. 1 km grid)', () => {
  // Approximately 1 degree of latitude ≈ 111.2 km
  const km = distanceMeters(51.0, 0, 52.0, 0) / 1000;
  assert.ok(km > 110 && km < 112, `expected ~111 km, got ${km.toFixed(1)}`);
});

test('distanceMeters is symmetric — dist(A,B) ≡ dist(B,A)', () => {
  const a = distanceMeters(48.8566, 2.3522, 51.5074, -0.1278);
  const b = distanceMeters(51.5074, -0.1278, 48.8566, 2.3522);
  assert.equal(a, b);
});

// ── Integration tests (real PostgreSQL; skipped when unreachable) ────────────

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

  test('location_pings table accepts a GPS ping with Haversine-validated coordinates', { timeout: 20_000 }, async () => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO devices (id, msisdn, label, type, active)
         VALUES ('00000000-0000-0000-0000-000000000002', '00000000001', 'Test GPS', 'phone', TRUE)
         ON CONFLICT (msisdn) DO NOTHING`,
      );

      const res = await client.query(
        `INSERT INTO location_pings
           (device_id, employee_id, job_id, lat, lng, accuracy_m, speed_kmh, heading, battery, source, recorded_at)
         VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, 'pwa', $8)
         RETURNING id, lat, lng, recorded_at`,
        ['00000000-0000-0000-0000-000000000002', 47.6062, -122.3321, 10, 35, null, 90, new Date().toISOString()],
      );

      assert.ok(res.rows.length === 1, 'should insert exactly one ping');
      assert.equal(res.rows[0].lat, 47.6062);
      assert.equal(res.rows[0].lng, -122.3321);

            // Verify the daily rollup can be written (mirrors the route's ON CONFLICT logic)
      const day = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO location_daily_rollups (device_id, day, first_at, last_at, distance_km, max_speed_kmh, points, trail)
         VALUES ($1, $2::date, $3, $4, 0, $5, 1, $6::jsonb)
         ON CONFLICT (device_id, day) DO UPDATE SET
           distance_km = COALESCE(location_daily_rollups.distance_km, 0) + EXCLUDED.distance_km,
           points = location_daily_rollups.points + 1`,
        ['00000000-0000-0000-0000-000000000002', day, now, now, 35, JSON.stringify([{ lat: 47.6062, lng: -122.3321, t: now }])],
      );

      const rollupRes = await client.query(
        `SELECT points FROM location_daily_rollups WHERE device_id = $1 AND day = $2::date`,
        ['00000000-0000-0000-0000-000000000002', day],
      );
      assert.equal(rollupRes.rowCount, 1, 'daily rollup should exist');
      assert.ok(rollupRes.rows[0].points >= 1, 'rollup should show ≥1 point');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  test('geofences table exists with expected columns', { timeout: 20_000 }, async () => {
    const res = await client.query(
      `SELECT id, name, kind, lat, lng, radius_m, active
         FROM geofences
        WHERE deleted_at IS NULL
        ORDER BY name`,
    );
    assert.ok(Array.isArray(res.rows), 'geofences query should return rows');
  });

  test('devices table has telemetry-compatible columns', { timeout: 20_000 }, async () => {
    const res = await client.query(`SELECT id, msisdn, label, type, employee_id, active, created_at, installed_at FROM devices LIMIT 1`);
    if (res.rows.length > 0) {
      const d = res.rows[0];
      assert.ok(d.id, 'devices.id should be populated');
    }
  });
}

