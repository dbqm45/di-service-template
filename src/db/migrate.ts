import { readdirSync, readFileSync } from 'node:fs';
import type pg from 'pg';

/**
 * Applies pending `NNN_description.sql` files from `migrations/`, in filename order, each in its own transaction
 * (Postgres DDL is transactional, so a failing file rolls back and stops the rest). Runs under an advisory lock, so
 * two instances starting together apply each file once. Pattern from ShipScope's server/lib/migrate.js.
 */
const MIGRATION_LOCK = 731_000;
export const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export async function runMigrations(pool: pg.Pool, dir: URL = MIGRATIONS): Promise<string[]> {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const pending = readdirSync(dir).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f) && !applied.has(f)).sort();
    const done: string[] = [];
    for (const file of pending) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(new URL(file, dir), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        done.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
      } finally {
        client.release();
      }
    }
    return done;
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    lock.release();
  }
}
