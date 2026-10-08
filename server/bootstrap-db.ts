import 'dotenv/config';
import { Client } from 'pg';
import { adminDatabaseLink, databaseName, databaseUrl } from './db-config';
import { seedData, seedPortalDemo, ensureOwner, ensureStaff } from './seed-data';
import { migrate } from './migrate';

/**
 * Ensure the application database exists, then apply pending migrations and
 * seed demo data when empty. Safe (idempotent) to run on every server start.
 *
 * Both clients below are built from the single DATABASE_URL link: the
 * maintenance client points at `postgres` (to CREATE DATABASE), the app
 * client at the database named inside the link.
 */
export async function ensureDatabase(): Promise<void> {
  const dbName = databaseName;

  // 1. Create the database itself if it does not exist (requires the admin DB).
  const admin = new Client({ connectionString: adminDatabaseLink });
  await admin.connect();
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${JSON.stringify(dbName)}`);
    console.log(`[db] Created database ${dbName}`);
  } else {
    console.log(`[db] Database ${dbName} already exists`);
  }
  await admin.end();

  // 2. Apply the schema and seed data to the application database.
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  // Some PostgreSQL installs ship with search_path="$user" only, which breaks
  // unqualified CREATE TABLE / SELECT statements. Force the public schema.
  await client.query(`ALTER DATABASE ${JSON.stringify(dbName)} SET search_path TO public`);
  await client.query('SET search_path TO public');

  const applied = await migrate(client);
  if (applied.length) console.log(`[db] Migrations applied: ${applied.join(', ')}`);

  const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM customers`);
  if (rows[0].count > 0) {
    console.log('[db] Data already present, skipping seed');
  } else {
    await seedData(client);
    console.log('[db] Seed data inserted');
  }

  // Identity is independent of demo data: databases seeded before Phase 0.4
  // still need their owner employee, and the four apps need demo staff to log
  // in with (plan v5 Phase C/D/E).
    await ensureOwner(client);
  await ensureStaff(client);

  // Portal demo dataset (plan v5 Phase B) — idempotent demo jobs/crew/timecards
  // and cost lines that used to be client fixtures. Runs after ensureStaff so the
  // demo employees exist to own the filings; unconditional so a non-empty DB still
  // picks the rows up on the next bootstrap.
  await seedPortalDemo(client);

  await client.end();
}
