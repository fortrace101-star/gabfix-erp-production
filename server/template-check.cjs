const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: '90210', database: 'gabfix' });
(async () => {
  try {
    const { rows } = await pool.query("SELECT key, channel, subject, body, approved FROM message_templates WHERE key LIKE 'order%' ORDER BY key, channel");
    console.log('ORDER-LIFECYCLE MESSAGE TEMPLATES:');
    rows.forEach((r) => console.log('  ', r.key, '|', r.channel, '| approved:', r.approved, '| body:', JSON.stringify(r.body)));
    const ev = await pool.query("SELECT DISTINCT kind FROM job_events ORDER BY kind");
    console.log('JOB_EVENTS KINDS:');
    ev.rows.forEach((r) => console.log('  ', r.kind));
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    await pool.end();
  }
})();
