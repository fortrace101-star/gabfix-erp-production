import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../db';
import { fail } from '../lib/http';
import { publish } from '../services/realtime';

/**
 * Telemetry routes (Phase 4 — Field operations, plan §14).
 *
 * - POST /api/telemetry/pings — submit a GPS ping from the /field PWA beacon
 *   or a hardware tracker; evaluates geofence entry/exit and publishes a
 *   `ping.recorded` SSE event (plan §6.3 line 134).
 * - GET  /api/telemetry/live  — current positions of all active devices.
 * - GET  /api/telemetry/trail/:deviceId — day's trail geometry for replay.
 */
export const telemetryRouter = Router();

/** Ingest shape for a location ping from the /field PWA beacon. */
type LocationPingInput = {
  deviceId: string;
  employeeId?: string | null;
  jobId?: string | null;
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  speed_kmh?: number | null;
  heading?: number | null;
  battery?: number | null;
  source?: string;
  recordedAt?: string;
};

/** Haversine distance in metres between two lat/lng points. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

telemetryRouter.post('/telemetry/pings', async (req: Request, res: Response) => {
  const body = req.body as Partial<LocationPingInput>;
  const { deviceId, employeeId, jobId, lat, lng, accuracy_m, speed_kmh, heading, battery, source = 'pwa', recordedAt } = body;

  if (!deviceId || lat === undefined || lng === undefined) {
    res.status(400).json({ error: 'deviceId, lat and lng are required' });
    return;
  }

  try {
    const client = await pool.connect();
    try {
      // 1. Insert the ping and return its id
      const insertResult = await client.query(
        `INSERT INTO location_pings
           (device_id, employee_id, job_id, lat, lng, accuracy_m, speed_kmh, heading, battery, source, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [deviceId, employeeId || null, jobId || null, lat, lng, accuracy_m ?? null, speed_kmh ?? null, heading ?? null, battery ?? null, source, recordedAt || new Date().toISOString()],
      );
                  const pingId = insertResult.rows[0].id;

      // 2. Evaluate geofence entry/exit
      const fences = await client.query(
        `SELECT id, name, lat, lng, radius_m, kind
           FROM geofences
          WHERE active AND deleted_at IS NULL`,
      );

      // Load the device's recent previous pings to determine prior fence state
      const prevPings = await client.query(
        `SELECT lat, lng FROM location_pings
           WHERE device_id = $1 AND id < $2
           ORDER BY recorded_at DESC
           LIMIT 5`,
        [deviceId, pingId],
      );

      const triggered: Array<{ fenceId: string; name: string; kind: string; event: 'enter' | 'exit' }> = [];

      for (const fence of fences.rows) {
        const fLat = Number(fence.lat);
        const fLng = Number(fence.lng);
        const fRadius = Number(fence.radius_m);
        const fId = fence.id;

        const nowInside = distanceMeters(lat, lng, fLat, fLng) <= fRadius;

        const wasInside = prevPings.rows.some(
          (pp) => distanceMeters(Number(pp.lat), Number(pp.lng), fLat, fLng) <= fRadius,
        );

        if (nowInside && !wasInside) {
          triggered.push({ fenceId: fId, name: fence.name, kind: fence.kind, event: 'enter' });
        } else if (!nowInside && wasInside) {
          triggered.push({ fenceId: fId, name: fence.name, kind: fence.kind, event: 'exit' });
        }
      }

      // 3. Update the daily rollup for this device/day
      const day = (recordedAt || new Date().toISOString()).slice(0, 10);
      await client.query(
        `INSERT INTO location_daily_rollups (device_id, day, first_at, last_at, distance_km, max_speed_kmh, points, trail)
         VALUES ($1, $2::date, $3, $4, 0, $5, 1, $6::jsonb)
         ON CONFLICT (device_id, day) DO UPDATE SET
           first_at = LEAST(location_daily_rollups.first_at, EXCLUDED.first_at),
           last_at = GREATEST(location_daily_rollups.last_at, EXCLUDED.last_at),
           distance_km = COALESCE(location_daily_rollups.distance_km, 0) + EXCLUDED.distance_km,
           max_speed_kmh = GREATEST(COALESCE(location_daily_rollups.max_speed_kmh, 0), EXCLUDED.max_speed_kmh),
           points = location_daily_rollups.points + 1,
           updated_at = now()`,
        [
          deviceId, day,
          recordedAt || new Date().toISOString(),
          recordedAt || new Date().toISOString(),
          speed_kmh ?? 0,
          JSON.stringify([{ lat, lng, t: recordedAt || new Date().toISOString() }]),
        ],
      );

      // 4. Publish SSE event
      publish({
        type: 'ping.recorded',
        by: employeeId || deviceId,
        payload: { deviceId, lat, lng, geofences: triggered },
      });

      res.status(201).json({ received: true, id: pingId, geofences: triggered.length });
    } finally {
      client.release();
    }
  } catch (error) {
    fail(res, error, 'Could not record telemetry ping');
  }
});

telemetryRouter.get('/telemetry/live', async (_req: Request, res: Response) => {
  try {
    const rows = await pool.query(`
      SELECT DISTINCT ON (p.device_id)
        p.device_id AS "deviceId",
        d.label,
        e.id AS "employeeId",
        e.name AS "employeeName",
        e.role AS "employeeRole",
        p.lat, p.lng,
        p.speed_kmh AS "speedKmh",
        p.recorded_at AS "recordedAt",
        p.battery
      FROM location_pings p
      JOIN devices d ON d.id = p.device_id
      LEFT JOIN employees e ON e.id = p.employee_id
      WHERE p.received_at > now() - interval '10 minutes'
      ORDER BY p.device_id, p.recorded_at DESC
    `);
    res.json(rows.rows);
  } catch (error) {
    fail(res, error, 'Could not load live positions');
  }
});

telemetryRouter.get('/telemetry/trail/:deviceId', async (req: Request, res: Response) => {
  try {
    const day = (req.query.day as string) || new Date().toISOString().slice(0, 10);
    const rows = await pool.query(
      `SELECT lat, lng, recorded_at AS "recordedAt", speed_kmh AS "speedKmh"
         FROM location_pings
        WHERE device_id = $1 AND recorded_at::date = $2::date
        ORDER BY recorded_at ASC`,
      [req.params.deviceId, day],
    );
        res.json(rows.rows);
  } catch (error) {
    fail(res, error, 'Could not load trail');
  }
});

telemetryRouter.get('/telemetry/geofences', async (_req: Request, res: Response) => {
  try {
    const rows = await pool.query(
      `SELECT id, name, kind, lat, lng, radius_m, active
         FROM geofences
        WHERE deleted_at IS NULL
        ORDER BY name`,
    );
    res.json(rows.rows);
  } catch (error) {
    fail(res, error, 'Could not load geofences');
  }
});

telemetryRouter.get('/telemetry/devices', async (_req: Request, res: Response) => {
  try {
    const rows = await pool.query(`
      SELECT
        d.id, d.msisdn, d.label, d.type, d.active, d.created_at, d.installed_at,
        e.id AS employee_id, e.name AS employee_name
      FROM devices d
      LEFT JOIN employees e ON e.id = d.employee_id
      WHERE d.deleted_at IS NULL
      ORDER BY d.created_at DESC
    `);
    res.json(rows.rows);
  } catch (error) {
    fail(res, error, 'Could not load devices');
  }
});
