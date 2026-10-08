/**
 * SQL plumbing for the write layer. Column maps and field validation live in
 * `validation/resources.ts` (Phase 0.7); this module only knows how to turn
 * (column, value) pairs into statements.
 */

/** Build an INSERT for one row of a registered table. */
export function insertSql(table: string, entries: [string, unknown][], id: string) {
  const columns = entries.map(([column]) => column);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  return {
    text: `INSERT INTO ${table} (id, ${columns.map((c) => `"${c}"`).join(', ')}) VALUES ($${columns.length + 1}, ${placeholders}) RETURNING id`,
    values: [...entries.map(([, value]) => value), id],
  };
}

/** Fallback primary key for an imported row that arrives without one. */
export const placeholderId = (table: string) => `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Tables wiped before a workspace replace or reset (order is irrelevant to TRUNCATE). */
export const TRUNCATE_TABLES = ['jobs', 'invoices', 'expenses', 'laundry_orders', 'equipment', 'inventory_items', 'customers', 'services', 'journal_lines', 'journal_entries', 'payments', 'asset_depreciation_entries', 'laundry_order_items', 'notifications', 'message_templates', 'settings', 'feedback', 'feedback_requests', 'location_pings', 'location_daily_rollups', 'geofences', 'inventory_movements', 'purchase_requests', 'tool_checkouts', 'utility_captures'];
