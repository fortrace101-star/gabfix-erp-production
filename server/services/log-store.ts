/**
 * In-memory ring buffer of recent request logs with optional file persistence.
 *
 * The ring buffer (last MAX_ENTRIES logs) provides fast history for the admin
 * console. File persistence (append JSON-lines to logs.jsonl) makes logs
 * survive restarts for post-incident review.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RequestLog {
  id: string;
  timestamp: string; // ISO
  appId: string;    // value of X-App-Id header, or "unknown"
  method: string;
  url: string;      // request path + query
  status: number;
  duration: number; // ms
  ip: string;
  userAgent: string;
    userId?: string;
  /** Raw request body, captured for diagnostic 4xx events (parse failures). */
  body?: string;
}

const MAX_ENTRIES = 1000;
const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'logs.jsonl');

const buffer: RequestLog[] = [];

/** Append a log to the ring buffer. Keeps only the most recent MAX_ENTRIES. */
export function appendLog(log: RequestLog): void {
  buffer.push(log);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  persistLog(log);
}

/** Persist a single log line to the JSONL file (best-effort, never throws). */
function persistLog(log: RequestLog): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(log) + '\n', { encoding: 'utf8' });
  } catch (err) {
    console.error('[log-store] Failed to persist log:', err instanceof Error ? err.message : err);
  }
}

/** Return the N most recent logs (newest first). */
export function getRecent(limit = 100): RequestLog[] {
  return buffer.slice(-limit).reverse();
}

/** Filter the ring buffer by criteria. All filters are optional. */
export interface LogFilter {
  appId?: string;
  method?: string;
  statusMin?: number;
  statusMax?: number;
  from?: string; // ISO date
  to?: string;   // ISO date
  search?: string; // free-text search on URL
}

export function queryLogs(filter: LogFilter, limit = 100): RequestLog[] {
  const from = filter.from ? new Date(filter.from).getTime() : 0;
  const to = filter.to ? new Date(filter.to).getTime() : Infinity;

  return buffer
    .slice()
    .reverse()
    .filter((log) => {
      if (filter.appId && log.appId !== filter.appId) return false;
      if (filter.method && log.method !== filter.method) return false;
      if (filter.statusMin !== undefined && log.status < filter.statusMin) return false;
      if (filter.statusMax !== undefined && log.status > filter.statusMax) return false;
      if (from && new Date(log.timestamp).getTime() < from) return false;
      if (to && new Date(log.timestamp).getTime() > to) return false;
      if (filter.search && !log.url.toLowerCase().includes(filter.search.toLowerCase())) return false;
      return true;
    })
    .slice(0, limit);
}

/** Load logs from the persisted file (for when the ring buffer is empty). */
export function loadFromFile(limit = 100): RequestLog[] {
  try {
    if (!existsSync(LOG_FILE)) return [];
    const raw = readFileSync(LOG_FILE, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RequestLog)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

/** Current ring-buffer size (for diagnostics). */
export function getBufferSize(): number {
  return buffer.length;
}