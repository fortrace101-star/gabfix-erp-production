// Live probe for plan v5 F2–F5 + E5 (temp file — deleted after the run).
require('dotenv').config();
const BASE = `http://localhost:${process.env.PORT || 5021}/api`;

async function j(path, init = {}, token) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-App-Id': init.appId || 'admin',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 60); }
  return { status: res.status, body };
}

(async () => {
  const checks = [];
  const ok = (name, cond, detail = '') => {
    checks.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // 1. Owner login
  const login = await j('/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'Gabriel N.', password: process.env.OWNER_PASSWORD }) });
  const token = login.body?.accessToken;
  ok('owner login', Boolean(token), `status ${login.status}`);
  if (!token) return console.log(checks.join('\n'));

  // 2. Scoped bell reads
  for (const scope of ['admin', 'laundry', 'portal', 'store']) {
    const r = await j(`/notifications/unread?scope=${scope}`, {}, token);
    ok(`bell read scope=${scope}`, r.status === 200 && Array.isArray(r.body), `status ${r.status}`);
  }

  // 3. laundry.ready → admin bell
  const ws = await j('/data', {}, token);
  const orders = ws.body?.laundry ?? [];
  const target = orders.find((o) => ['Received', 'Washing', 'Drying'].includes(o.status)) ?? orders[0];
  if (target) {
    if (target.status !== 'Washing' && target.status !== 'Drying') {
      await j(`/laundry/${target.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Washing' }) }, token);
    }
    const ready = await j(`/laundry/${target.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Ready' }) }, token);
    ok('laundry → Ready', ready.status === 200, target.number);
    const adminBell = await j('/notifications/unread?scope=admin', {}, token);
    ok('laundry.ready → admin bell', adminBell.body?.some?.((n) => n.template_key === 'laundry_ready'));
  } else {
    ok('laundry.ready', false, 'no laundry orders');
  }

  // 4. job.assigned → portal bell (employee-scoped)
  const staff = await j('/employees/assignable', {}, token);
  const john = (staff.body ?? []).find((e) => /john/i.test(e.name)) ?? (staff.body ?? [])[0];
  const job = (ws.body?.jobs ?? []).find((x) => x.status !== 'Paid');
  const assigned = await j(`/jobs/${job.id}/assignments`, { method: 'POST', body: JSON.stringify({ employeeId: john.id }) }, token);
  ok('POST assignments', assigned.status === 201, `status ${assigned.status}`);
  const portalBell = await j(`/notifications/unread?scope=portal&employeeId=${john.id}`, {}, token);
  ok('job.assigned → portal bell', portalBell.body?.some?.((n) => n.template_key === 'job_assigned' && n.entity_id === job.id));

  // 5. purchase.approved → store bell
  const inv = (ws.body?.inventory ?? [])[0];
  const pr = await j('/store/purchase-requests', { method: 'POST', body: JSON.stringify({ itemId: inv.id, description: 'probe request', qty: 2, value: 40000 }) }, token);
  ok('purchase request raised', pr.status === 201, `status ${pr.status} body ${JSON.stringify(pr.body).slice(0, 120)}`);
  const decided = await j(`/store/purchase-requests/${pr.body.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Approved', decidedBy: 'probe' }) }, token);
  ok('purchase approved', decided.status === 200);
  const storeBell = await j('/notifications/unread?scope=store', {}, token);
  ok('purchase.approved → store bell', storeBell.body?.some?.((n) => n.template_key === 'purchase_approved' && n.entity_id === pr.body.id));

  // 6. job.completed → admin bell with feedback_url → POST feedback → feedback.received
  const completable = (ws.body?.jobs ?? []).find((x) => x.status === 'In Progress' || x.status === 'Scheduled' || x.status === 'Quoted');
  const completableCustomer = completable?.customerId ?? '';
  const comp = await j(`/jobs/${completable.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'Completed' }) }, token);
  ok('job completed', comp.status === 200, `status ${comp.status}`);
  await new Promise((r) => setTimeout(r, 300));
  let token_ = '';
  // The feedback link lives on the CUSTOMER's completion row (legacy bell endpoint).
  for (const n of (await j(`/notifications/unread/${completableCustomer}`, {}, token)).body ?? []) {
    const m = String(n.payload?.feedback_url || '').match(/feedback\/([a-f0-9]+)/);
    if (m) { token_ = m[1]; break; }
  }
  ok('completion bell carries feedback_url', Boolean(token_));
  if (token_) {
    const fb = await j(`/feedback/${token_}`, { method: 'POST', body: JSON.stringify({ rating: 5, comment: 'probe feedback' }) });
    ok('feedback POST', fb.status === 200, `status ${fb.status}`);
    const adminBell2 = await j('/notifications/unread?scope=admin', {}, token);
    ok('feedback.received → admin bell', adminBell2.body?.some?.((n) => n.template_key === 'feedback_received'));
  }

  // 7. read-all
  const readAll = await j('/notifications/read-all', { method: 'POST', body: JSON.stringify({ scope: 'store' }) }, token);
  ok('read-all store', readAll.status === 200 && readAll.body?.updated >= 1, `updated ${readAll.body?.updated}`);
  const storeBell2 = await j('/notifications/unread?scope=store', {}, token);
  ok('store bell emptied', (storeBell2.body ?? []).length === 0);

  // 8. utility-slip PDF
  const cap = (ws.body?.utilityCaptures ?? [])[0];
  const pdf = await fetch(`${BASE}/documents/utility-slip/${cap.id}.pdf`, { headers: { Authorization: `Bearer ${token}`, 'X-App-Id': 'admin' } });
  const buf = Buffer.from(await pdf.arrayBuffer());
  ok('utility-slip PDF', pdf.status === 200 && buf.subarray(0, 5).toString() === '%PDF-', `${buf.length} bytes`);

  console.log(checks.join('\n'));
  console.log(checks.every((c) => c.startsWith('PASS')) ? 'ALL GREEN' : 'FAILURES PRESENT');
})();
