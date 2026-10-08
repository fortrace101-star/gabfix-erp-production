const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: '90210', database: 'gabfix' });
(async () => {
  try {
    const { rows } = await pool.query('SELECT id, name, role, app_scope, active FROM employees WHERE active = TRUE ORDER BY role, name');
    console.log('EMPLOYEES:');
    rows.forEach((r) => console.log('  ', r.id, r.name, r.role, r.app_scope, 'active=' + r.active));
    const [depts] = await pool.query("SELECT id, name, type, salesperson_id, active FROM departments ORDER BY id");
    console.log('DEPARTMENTS:');
    depts.rows.forEach((r) => console.log('  ', r.id, r.name, r.type, r.salesperson_id, 'active=' + r.active));
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    await pool.end();
  }
})();
