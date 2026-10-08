import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';

process.env.JWT_SECRET = 'test-secret-0c';

const { signTokens, verifyToken, requireScope } = await import('../middleware/auth');
const { resetSubscribers, subscribe } = await import('../services/realtime');

const owner = { id: 'u1', name: 'Gabriel N.', role: 'owner', app_scope: ['admin', 'laundry', 'portal', 'store'] };
const portalUser = { id: 'u2', name: 'Field Tech', role: 'technician', app_scope: ['portal'] };

test('signTokens embeds app_scope in both access and refresh tokens', () => {
  const access = verifyToken(signTokens(owner).accessToken, 'access');
  const refresh = verifyToken(signTokens(owner).refreshToken, 'refresh');
  assert.deepEqual(access?.app_scope, owner.app_scope);
  assert.deepEqual(refresh?.app_scope, owner.app_scope);
});

test('access tokens do not verify as refresh tokens (type confusion rejected)', () => {
  const { accessToken } = signTokens(owner);
  assert.equal(verifyToken(accessToken, 'refresh'), null);
});

test('tampered tokens are rejected', () => {
  const { accessToken } = signTokens(owner);
  const tampered = accessToken.slice(0, -2) + (accessToken.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(verifyToken(tampered, 'access'), null);
});

test('pre-0c tokens without app_scope fall back to the control-plane scope', () => {
  // Hand-crafted legacy payload signed with the test secret.
  const legacy = jwt.sign({ sub: 'u9', name: 'Old Session', role: 'owner', typ: 'access' }, 'test-secret-0c', { expiresIn: '1h' });
  const user = verifyToken(legacy, 'access');
  assert.deepEqual(user?.app_scope, ['admin']);
});

test('requireScope allows a matching scope and rejects a missing one (enforced)', async () => {
  process.env.AUTH_ENFORCE = 'true';
  const middleware = requireScope('admin', 'portal');
  const run = (user: typeof owner | typeof portalUser | undefined) =>
    new Promise<number>((resolve) => {
      const req = { user } as Request;
      const res = { status(code: number) { resolve(code); return { json() {} } as Response; } } as unknown as Response;
      middleware(req as Request, res, () => resolve(200));
    });
  assert.equal(await run(owner), 200);
  assert.equal(await run(portalUser), 200);
  assert.equal(await run({ ...portalUser, app_scope: ['store'] }), 403);
  assert.equal(await run(undefined), 401);
  delete process.env.AUTH_ENFORCE;
});

test('requireScope is a pass-through while enforcement is staged off', async () => {
  delete process.env.AUTH_ENFORCE;
  const middleware = requireScope('admin');
  const result = await new Promise<string>((resolve) => {
    const req = {} as Request;
    const res = { status() { return { json() {} } as Response; } } as unknown as Response;
    middleware(req, res, () => resolve('next'));
  });
  assert.equal(result, 'next');
});

beforeEach(() => {
  resetSubscribers();
});

test('realtime bus fans out to subscribers and survives throwing ones', async () => {
  const { publish } = await import('../services/realtime');
  const seen: string[] = [];
  const unsubscribe = subscribe((event) => seen.push(event.type));
  subscribe(() => {
    throw new Error('bad subscriber');
  });
  publish({ type: 'job-created' });
  publish({ type: 'expense-created' });
  assert.deepEqual(seen, ['job-created', 'expense-created']);
  unsubscribe();
});
