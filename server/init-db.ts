import 'dotenv/config';
import { ensureDatabase } from './bootstrap-db';

ensureDatabase()
  .then(() => console.log('Database ready.'))
  .catch((error) => {
    console.error('Database init failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
