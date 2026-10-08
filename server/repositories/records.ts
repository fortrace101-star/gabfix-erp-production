import type { Pool, PoolClient } from 'pg';
import { pool } from '../db';
import { ValidationError } from '../lib/http';
import { insertSql, placeholderId, TRUNCATE_TABLES } from '../lib/tables';
import { parseBody, toColumnEntries } from '../validation/common';
import { RESOURCES, type Resource } from '../validation/resources';

/** Either the shared pool or a transaction client. */
type Executor = Pool | PoolClient;

/** Insert one validated row and return its primary key. */
export async function insertRecord(resource: Resource, data: Record<string, unknown>, id: string, executor: Executor = pool): Promise<string> {
  const entries = toColumnEntries(resource.columns, data, resource.jsonColumns);
  const { rows } = await executor.query(insertSql(resource.table, entries, id));
  return rows[0].id as string;
}

/** Update one validated row; returns the number of rows changed (0 when the id is unknown). */
export async function updateRecord(resource: Resource, id: string, data: Record<string, unknown>): Promise<number> {
  const entries = toColumnEntries(resource.columns, data, resource.jsonColumns);
  const sets = entries.map(([column], index) => `"${column}" = $${index + 1}`).join(', ');
  const { rowCount } = await pool.query(
    `UPDATE ${resource.table} SET ${sets} WHERE id = $${entries.length + 1}`,
    [...entries.map(([, value]) => value), id],
  );
  return rowCount ?? 0;
}

/**
 * Tables that a workspace wipe must never lose. Kept after 006 removed the
 * last inbound foreign key (employees.branch_id -> branches): TRUNCATE CASCADE
 * only reaches what still references, but the snapshot/restore is cheap
 * insurance against future schema additions re-introducing the hazard.
 */
const IDENTITY_TABLES = ['employees', 'devices'];

/** Re-insert rows deleted by a cascading truncate, keeping ids and timestamps. */
async function restoreRows(client: Executor, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  const columnList = columns.map((column) => `"${column}"`).join(', ');
  for (const row of rows) {
    const values = columns.map((column) => row[column]);
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    await client.query(
      `INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
      values,
    );
  }
}

/** Delete every managed row, leaving the schema and identity data intact. */
export async function truncateWorkspace(client: Executor): Promise<void> {
  const identity: [string, Record<string, unknown>[]][] = [];
  for (const table of IDENTITY_TABLES) {
    const { rows } = await client.query(`SELECT * FROM ${table}`);
    identity.push([table, rows]);
  }

  await client.query(`TRUNCATE ${TRUNCATE_TABLES.join(', ')} CASCADE`);

  // Restore staff logins and devices wiped by the cascade, parents first. This
  // runs inside the caller's transaction, so a failed import/reset rolls the
  // whole wipe back rather than leaving identity rows behind.
  for (const [table, rows] of identity) await restoreRows(client, table, rows);
}

/**
 * Replace the whole workspace from a backup payload (POST /api/import).
 * Every row is validated against its resource schema, so an unknown field in a
 * backup is reported (422) with the collection and row position instead of
 * being dropped. Caller owns the transaction.
 */
export async function replaceAll(client: PoolClient, payload: Record<string, unknown>): Promise<void> {
  for (const resource of RESOURCES) {
    const rows = payload[resource.dataKey];
    if (!Array.isArray(rows)) continue;
    for (const [index, row] of rows.entries()) {
      let parsed: Record<string, unknown>;
      try {
        parsed = parseBody(resource.row, row) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof ValidationError) throw withRowContext(resource, index, error);
        throw error;
      }
      const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : placeholderId(resource.table);
      await insertRecord(resource, parsed, id, client);
    }
  }
}

/** Prefix field errors with the collection and row they came from, e.g. `jobs[3].note`. */
function withRowContext(resource: Resource, index: number, error: ValidationError): ValidationError {
  const fields: Record<string, string> = {};
  for (const [field, message] of Object.entries(error.fields)) {
    fields[field === '_' ? field : `${resource.dataKey}[${index}].${field}`] = message;
  }
  return new ValidationError(fields);
}
