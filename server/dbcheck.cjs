const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: '90210', database: 'gabfix' });
(async () => {
  try {
    const r = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    console.log('SCHEMA MIGRATIONS:', r.rows.map((x) => x.id).join(', '));
    const jobs = await pool.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = \'jobs\' ORDER BY ordinal_position');
    console.log('JOBS COLUMNS:');
    jobs.rows.forEach((c) => console.log('  ', c.column_name, c.data_type));
    const idx = await pool.query("SELECT tablename, indexname FROM pg_indexes WHERE tablename IN ('jobs','job_checklist_items','job_events') ORDER BY tablename");
    console.log('JOB/ACTIVITY INDEXES:');
    idx.rows.forEach((x) => console.log('  ', x.tablename, x.indexname));
  } catch (e) {
    console.error('ERR', e.message);
  } finally {
    await pool.end();
  }
})();
