import pg from 'pg';

/** A connection pool; TLS unless the configuration turns it off for a local container. */
export function createPool(input: { databaseUrl: string; databaseSsl: boolean }): pg.Pool {
  return new pg.Pool({ connectionString: input.databaseUrl, ssl: input.databaseSsl ? { rejectUnauthorized: true } : false });
}
