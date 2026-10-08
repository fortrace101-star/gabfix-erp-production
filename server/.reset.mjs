import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 5432, user: 'postgres', password: '90210', database: 'gabfix', connectionTimeoutMillis: 4000 });
const TECH = '00000000-0000-4000-8000-000000000013'; // John Kato (technician)
try {
  await c.connect();
  // 1. Clear dev-probe artifacts (JOB-00145/00146 live probes) that blocked tests.
  const fr = await c.query('DELETE FROM feedback_requests WHERE job_id LIKE $1', ['j1790%']);
  process.stdout.write('feedback_requests deleted: ' + fr.rowCount + '\n');
  const jb = await c.query('DELETE FROM jobs WHERE id LIKE $1', ['j1790%']);
  process.stdout.write('jobs deleted: ' + jb.rowCount + '\n');
  // 2. Dual-write crew assignments (seedData is skipped on non-empty DBs, so seed
  //    directly: Technician John Kato owns j1 (In Progress), j3 (Scheduled), j5 (Done).
  const ins = await c.query(
    `INSERT INTO job_assignments (job_id, employee_id, role)
       VALUES
         ('j1', $1, 'technician'),
         ('j3', $1, 'technician'),
         ('j5', $1, 'technician')
     ON CONFLICT (job_id, employee_id) DO NOTHING`,
    [TECH],
  );
  process.stdout.write('job_assignments inserted: ' + ins.rowCount + '(0 = already present)\n');
  const left = await c.query('SELECT id, number FROM jobs WHERE scheduled_date IS NULL');
  process.stdout.write('NULL-scheduled jobs: ' + JSON.stringify(left.rows) + '\n');
  const ja = await c.query('SELECT job_id, employee_id, role FROM job_assignments WHERE job_id IN ($1,$2,$3,$4,$5,$6) ORDER BY job_id', ['j1','j2','j3','j4','j5','j6']);
  process.stdout.write('seed assignments: ' + JSON.stringify(ja.rows) + '\n');
} catch (e) {
  process.stderr.write('ERR: ' + (e && e.message ? e.message : String(e)) + '\n');
} finally {
  await c.end().catch(() => undefined);
}
