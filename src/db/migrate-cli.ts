import { loadConfig } from '../config.ts';
import { createPool } from './pool.ts';
import { runMigrations } from './migrate.ts';

const config = loadConfig();
const pool = createPool(config);
try {
  const applied = await runMigrations(pool);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
} finally {
  await pool.end();
}
