import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';

process.env.JWT_SECRET = 'test-secret-events';

const { signTokens } = await import('../middleware/auth');
const { eventsRouter } = await import('../routes/events');
const { resetSubscribers, publish } = await import('../services/realtime');

/**
 * Minimal response double: records the status and every write, and captures
 * the `close` handler so afterEach can release the SSE heartbeat interval —
 * otherwise it keeps the node:test process alive forever.
 */
class FakeResponse {
  status(code: number) {
    FakeResponse.lastStatus = code;
    return { json: () => {} };
  }
  writeHead(code: number, _headers?: Record<string, string>) {
    FakeResponse.lastStatus = code;
  }
  write(chunk: string) {
    FakeResponse.written.push(chunk);
    return true;
  }
  on(event: string, handler: () => void) {
    if (event === 'close') FakeResponse.closeHandlers.push(handler);
  }
  static lastStatus: number | null = null;
  static written: string[] = [];
  static closeHandlers: Array<() => void> = [];
  static reset() {
    FakeResponse.lastStatus = null;
    FakeResponse.written = [];
  }
  static emitClose() {
    for (const handler of FakeResponse.closeHandlers) handler();
    FakeResponse.closeHandlers = [];
  }
}

function runRoute(opts: { headerToken?: string; queryToken?: string }): void {
  const headers: Record<string, string> = {};
  if (opts.headerToken) headers.authorization = `Bearer ${opts.headerToken}`;
  const req = {
    headers,
    query: opts.queryToken !== undefined ? { access_token: opts.queryToken } : {},
    on: () => {},
  } as unknown as Request;
  const res = new FakeResponse();
  // The router has a single GET layer; pull its handler out directly.
  const layer = (eventsRouter as unknown as { stack: Array<{ route: { stack: Array<{ handle: (q: Request, r: FakeResponse, n: () => void) => void }> } }> }).stack[0];
  layer.route.stack[0].handle(req, res as never, () => {});
}

beforeEach(() => {
  // Set per-test: other files in the suite toggle this env var.
  process.env.AUTH_ENFORCE = 'true';
  FakeResponse.reset();
  resetSubscribers();
});

afterEach(() => {
  // Release the heartbeat timers of any streams opened during the test.
  FakeResponse.emitClose();
});

test('SSE accepts a Bearer header token when enforcement is on', () => {
  const { accessToken } = signTokens({ id: 'u1', name: 'Owner', role: 'owner', app_scope: ['admin'] });
  runRoute({ headerToken: accessToken });
  assert.equal(FakeResponse.lastStatus, 200);
  assert.ok(FakeResponse.written.join('').includes(': connected'));
});

test('SSE accepts ?access_token= (EventSource path) when enforcement is on', () => {
  const { accessToken } = signTokens({ id: 'u1', name: 'Owner', role: 'owner', app_scope: ['admin'] });
  runRoute({ queryToken: accessToken });
  assert.equal(FakeResponse.lastStatus, 200);
  assert.ok(FakeResponse.written.join('').includes(': connected'));
});

test('SSE rejects an invalid token with 401', () => {
  runRoute({ queryToken: 'not-a-jwt' });
  assert.equal(FakeResponse.lastStatus, 401);
  assert.deepEqual(FakeResponse.written, []);
});

test('SSE rejects a missing token with 401', () => {
  runRoute({});
  assert.equal(FakeResponse.lastStatus, 401);
  assert.deepEqual(FakeResponse.written, []);
});

test('SSE rejects a valid token with no app scopes with 403', () => {
  const { accessToken } = signTokens({ id: 'u2', name: 'No Scope', role: 'staff', app_scope: [] });
  runRoute({ headerToken: accessToken });
  assert.equal(FakeResponse.lastStatus, 403);
  assert.deepEqual(FakeResponse.written, []);
});

test('connected SSE clients receive bus events', () => {
  const { accessToken } = signTokens({ id: 'u1', name: 'Owner', role: 'owner', app_scope: ['admin'] });
  runRoute({ headerToken: accessToken });
  publish({ type: 'notification' });
  const out = FakeResponse.written.join('');
  assert.ok(out.includes('event: notification'), 'event frame should be streamed');
  assert.ok(out.includes('"type":"notification"'), 'event payload should be streamed');
});
