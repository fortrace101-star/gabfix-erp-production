import 'dotenv/config';

/**
 * The database access credentials live in ONE connection link instead of
 * five separate variables. Every connection in the server — the API pool
 * (db.ts), the bootstrap admin/app clients (bootstrap-db.ts) and the health
 * endpoint (index.ts) — derives from this single value:
 *
 *   DATABASE_URL=postgresql://postgres:90210@127.0.0.1:5432/gabfix
 *
 * (host, port, user, password and database name are all parts of the link).
 *
 * If DATABASE_URL is not set, the legacy PGHOST/PGPORT/PGUSER/PGPASSWORD/
 * PGDATABASE variables are folded into the same link so older environments
 * keep booting — deprecated, replace them with DATABASE_URL.
 */

/** Database assumed when neither the link nor the legacy vars name one. */
const DEFAULT_DATABASE = 'gabfix';

/** Fold the deprecated individual PG* variables into a single link. */
function linkFromLegacyVars(): string {
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT || '5432';
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || '';
  const database = process.env.PGDATABASE || DEFAULT_DATABASE;
  const auth = user
    ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  return `postgresql://${auth}${host}:${port}/${encodeURIComponent(database)}`;
}

/** Parse + normalise a link; throws a readable error on a malformed value. */
function normalise(link: string): URL {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    // Never echo the raw link: it carries the password.
    throw new Error('DATABASE_URL is not a valid postgresql:// connection link');
  }

  // When the host is "localhost" the OS resolver can hand back ::1 (IPv6) or
  // 127.0.0.1 (IPv4) and pg's native client has been observed to stall on the
  // wrong family on Windows, producing "timeout exceeded when trying to
  // connect". Pin to 127.0.0.1 (Postgres listens on *, so this always works)
  // unless the link names something else.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';

  if (!url.pathname || url.pathname === '/') url.pathname = `/${DEFAULT_DATABASE}`;

  // Render's managed PostgreSQL (and most cloud PG hosts) requires SSL/TLS.
  // Ensure the connection string includes the sslmode=require query parameter
  // so that the server accepts the connection. Append after any existing
  // query params to avoid clobbering them.
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
  return url;
}

const configured = process.env.DATABASE_URL?.trim();
if (!configured) {
  console.warn('[db] DATABASE_URL is not set — folding the deprecated PG* variables into one link.');
}

/** The single database link every server connection is built from. */
export const databaseUrl = normalise(configured || linkFromLegacyVars()).toString();

/** Database name, read from the link (used by /api/health and bootstrap). */
export const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));

/** The same link pointed at another database (e.g. the `postgres` maintenance DB). */
export function databaseLinkFor(name: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

/** Link to the maintenance database bootstrap uses to CREATE DATABASE. */
export const adminDatabaseLink = databaseLinkFor('postgres');
