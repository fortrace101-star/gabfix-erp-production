const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: '90210', database: 'gabfix' });
(async () => {
  const res = await fetch('http://localhost:5000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'Gabriel N.', password: 'gabfix-owner' }) });
  const j = await res.json();
  console.log('owner token ok, length=' + j.accessToken.length);
  const c = await pool.query('SELECT id FROM customers ORDER BY id LIMIT 1');
  const s = await pool.query('SELECT id FROM services ORDER BY id LIMIT 1');
  console.log('customerId=' + c.rows[0].id + ' serviceId=' + s.rows[0].id);
  for (const payload of [
    { customerId: c.rows[0].id, serviceId: s.rows[0].id, date: '2026-11-02', source: 'salesperson' },
    { customerId: c.rows[0].id, serviceId: s.rows[0].id, date: '2026-11-02' },
    { customerId: c.rows[0].id, serviceId: s.rows[0].id }
  ]) {
    const r = await fetch('http://localhost:5000/api/orders/proposals', { method: 'POST', headers: { 'Authorization': 'Bearer ' + j.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const t = await r.text();
    console.log('payload=' + JSON.stringify(payload) + ' -> ' + r.status + ' ' + t.slice(0, 400));
  }
})();
