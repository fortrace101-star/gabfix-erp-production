import 'dotenv/config';
import { pool } from './db';

const c = await pool.query(
  `SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
   JOIN pg_class t ON t.oid = c.conrelid WHERE t.relname = 'employees'`,
);
c.rows.forEach((r) => console.log(r.conname, '->', r.def));
await pool.end();