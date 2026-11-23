import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPool } from '../src/db/pool.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { postgresEventStore } from '../src/events/store.ts';
import { event } from './helpers.ts';

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;

test('migrations apply once and the event store deduplicates by id', { skip: !url && 'TEST_DATABASE_URL is not set' }, async () => {
  const pool = createPool({ databaseUrl: url!, databaseSsl: false });
  try {
    await pool.query('DROP TABLE IF EXISTS received_events, schema_migrations');
    const [first, second] = await Promise.all([runMigrations(pool), runMigrations(pool)]);
    assert.deepEqual([...first!, ...second!], ['001_received_events.sql']);
    const store = postgresEventStore(pool);
    assert.equal(await store.save(event({ id: 'db-1' }) as never), true);
    assert.equal(await store.save(event({ id: 'db-1' }) as never), false);
    const { rows } = await pool.query('SELECT type, payload FROM received_events');
    assert.deepEqual(rows, [{ type: 'gate.decided', payload: { change: 'CHG-1' } }]);
  } finally {
    await pool.end();
  }
});
