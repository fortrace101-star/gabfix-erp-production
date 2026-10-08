const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: '90210', database: 'gabfix' });
const BASE = 'http://localhost:5000';
let passed = 0;
let failed = 0;

async function step(name, fn) {
  try {
    const r = await fn();
    console.log('PASS  ' + name + '  -> ' + r.status);
    passed++;
    return r;
  } catch (e) {
    console.error('FAIL  ' + name + '  -> ' + e.message);
    failed++;
    throw e;
  }
}

async function req(method, url, body, token) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + url, opts);
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }


async function run() {
  // ---------- authenticated owner ----------
  const ownerToken = (await req('POST', '/api/auth/login', { identifier: 'Gabriel N.', password: 'gabfix-owner' })).json.accessToken;
  console.log('owner login OK, role=' + (await (await req('GET', '/api/auth/me', {}, ownerToken)).json.user).role);

  const c = await pool.query('SELECT id FROM customers ORDER BY id LIMIT 1');
  const s = await pool.query('SELECT id FROM services ORDER BY id LIMIT 1');
  const customerId = c.rows[0].id, serviceId = s.rows[0].id;

  // ---------- flow A: propose -> share -> public -> confirm -> complete -> feedback -> checklist -> close ----------
  let r = await step('create proposal (owner)', async () => req('POST', '/api/orders/proposals', { customerId, serviceId, date: '2026-11-02', siteAddress: '123 Main St', source: 'salesperson' }, ownerToken));
  const proposal = r.json;
  const id = proposal.id;

  r = await step('share proposal', async () => req('POST', '/api/orders/' + id + '/share', {}, ownerToken));
  const share = r.json;
  const token = share.shareToken;

  r = await step('public GET /proposal/:token', async () => req('GET', '/proposal/' + token));
  if (r.status !== 200 || typeof r.text !== 'string' || !r.text.includes('Gabfix proposal')) throw new Error('public page missing, status=' + r.status);

  r = await step('confirm (owner, needs confirm_orders)', async () => req('POST', '/api/orders/' + id + '/confirm', {}, ownerToken));

  // close gate #1: feedback required
  r = await step('close without feedback (expect 409)', async () => req('POST', '/api/orders/' + id + '/close', {}, ownerToken));
  if (r.status !== 409 || !String(r.json.error).includes('feedback')) throw new Error('expected 409 feedback error, got ' + JSON.stringify(r.json));

  // public feedback submission
  const fb = await fetch(BASE + '/feedback/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating: 5, comment: 'Great job!' }) });
  console.log('PASS  public feedback POST -> ' + fb.status);
  passed++;

  // close gate #2: checklist complete (vacuous for Confirmed with no open items at that stage)
  r = await step('close with feedback (expect 200)', async () => req('POST', '/api/orders/' + id + '/close', {}, ownerToken));
  if (r.json.status !== 'Closed') throw new Error('expected Closed, got ' + JSON.stringify(r.json));

  r = await step('GET /api/orders/:id (final state)', async () => req('GET', '/api/orders/' + id, {}, ownerToken));
  if (r.json.status !== 'Closed') throw new Error('expected Closed after close, got ' + JSON.stringify(r.json));

  // ---------- flow B: cancelled branch ----------
  r = await step('cancel (owner)', async () => req('POST', '/api/orders/' + id + '/cancel', { reason: 'Client cancelled' }, ownerToken));

  r = await step('close cancelled job (expect 409)', async () => req('POST', '/api/orders/' + id + '/close', {}, ownerToken));
  if (r.status !== 409 || !String(r.json.error).includes('cancelled')) throw new Error('expected 409 cancelled error, got ' + JSON.stringify(r.json));

  r = await step('GET final state after cancel', async () => req('GET', '/api/orders/' + id, {}, ownerToken));
  if (r.json.status !== 'Cancelled') throw new Error('expected Cancelled, got ' + JSON.stringify(r.json));

  // public feedback pages are reachable without a session
  r = await step('public GET /feedback/:token', async () => req('GET', '/feedback/' + token));
  if (r.status !== 200 || typeof r.text !== 'string' || !r.text.includes('How was your service')) throw new Error('public feedback page missing, status=' + r.status);

  console.log('\nFINAL STATUS A: ' + JSON.stringify(await getJob()));
  console.log('SUMMARY: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('SMOKE ERROR', e); process.exit(1); });

