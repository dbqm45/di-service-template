import type pg from 'pg';
import type { Event } from './envelope.ts';

/** Where received events go. `save` answers false for an event id already stored (a retry). */
export interface EventStore {
  save(event: Event): Promise<boolean>;
}

export function postgresEventStore(pool: pg.Pool): EventStore {
  return {
    async save(e) {
      const res = await pool.query(
        `INSERT INTO received_events (id, type, source, occurred_at, contract_version, payload)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [e.id, e.type, e.source, e.occurred_at, e.contract_version, e.payload],
      );
      return res.rowCount === 1;
    },
  };
}

/** For tests and for running without a database. */
export function memoryEventStore(): EventStore & { events: Event[] } {
  const events: Event[] = [];
  return {
    events,
    async save(e) {
      if (events.some((x) => x.id === e.id)) return false;
      events.push(e);
      return true;
    },
  };
}
