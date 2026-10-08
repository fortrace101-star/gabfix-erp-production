const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: '90210', database: 'gabfix' });
(async () => {
  try {
    const { rows } = await pool.query(`SELECT id, name, pin_hash FROM employees WHERE name ILIKE '%gabriel%' OR name ILIKE '%owner%' OR name ILIKE '%admin%' ORDER BY id`);
    console.log('OWNER-ISH EMPLOYEES:');
    rows.forEach((r) => console.log('  ', r.id, r.name, JSON.stringify(r.pin_hash?.slice(0, 20) + '…')));
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    await pool.end();
  }
})();
