/**
 * Workspace reads. `getData` lives in `db.ts` next to the pool it queries; this
 * module is the single import point for route handlers, so the read path can be
 * split into scoped queries (Phase 0.11) without touching the routes again.
 */
export { getData, type AppData } from '../db';
