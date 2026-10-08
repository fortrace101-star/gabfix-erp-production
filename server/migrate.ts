import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ClientBase } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');

/** Anything that can run SQL on a single connection (pg Client or pool Client). */
export type Queryable = Pick<ClientBase, 'query'>;

const applied = (client: Queryable, id: string) =>
  client.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [id]).then(({ rows }) => rows.length > 0);

/** Session-level advisory lock so concurrent runners (server boot + tests) serialise. */
const MIGRATION_LOCK_KEY = 727261;

/**
 * Apply every unapplied file in server/migrations exactly once, in lexicographic
 * order, recording each in schema_migrations. Each file runs inside its own
 * transaction: it either lands fully or not at all, and a failure names the
 * offending file. Re-running is a no-op.
 *
 * Reconciliation: an existing database created before migrations existed gets
 * its baseline (001_baseline.sql) recorded without re-executing it, because the
 * objects are already present.
 *
 * Returns the ids of migrations applied during this call.
 */
export async function migrate(client: Queryable, log: (message: string) => void = console.log): Promise<string[]> {
  // Two runners (server boot and the test suite, say) can reach the applied()
  // check at the same moment; the advisory lock serialises them so the second
  // sees the first's schema_migrations rows instead of racing the INSERT.
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    return await runMigrations(client, log);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
  }
}

async function runMigrations(client: Queryable, log: (message: string) => void): Promise<string[]> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (await applied(client, file)) continue;

    // Reconcile a pre-migration database: the baseline objects already exist,
    // so record the migration without executing it.
    if (file.startsWith('001_')) {
      const { rows } = await client.query(`SELECT to_regclass('public.branches') IS NOT NULL AS present`);
      if (rows[0].present) {
        await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
        log(`[db] ${file} reconciled (baseline already present)`);
        ran.push(file);
        continue;
      }
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      log(`[db] Applied ${file}`);
      ran.push(file);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${reason}`);
    }
  }

  if (!ran.length) log('[db] Schema up to date');
  return ran;
}

/** Standalone entry point: `npx tsx migrate.ts` (or `npm run db:migrate`). */
async function main() {
  const { pool } = await import('./db');
  const client = await pool.connect();
  try {
    const ran = await migrate(client);
    logSummary(ran);
  } finally {
    client.release();
    await pool.end();
  }
}

const logSummary = (ran: string[]) => console.log(ran.length ? `Migrated: ${ran.join(', ')}` : 'Nothing to migrate.');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}