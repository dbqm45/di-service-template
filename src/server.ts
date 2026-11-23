import { readFileSync } from 'node:fs';
import { buildApp } from './app.ts';
import { createVerifier, discoveryJwks } from './auth/oidc.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db/pool.ts';
import { runMigrations } from './db/migrate.ts';
import { loadVocabulary } from './events/envelope.ts';
import { postgresEventStore } from './events/store.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const config = loadConfig(process.env, version);
const pool = createPool(config);
await runMigrations(pool);

const app = buildApp({
  version,
  verifier: createVerifier({
    issuer: config.oidcIssuer,
    audience: config.oidcAudience,
    authorizedParties: config.oidcAuthorizedParties,
    serviceClients: config.oidcServiceClients,
    fetchJwks: discoveryJwks(config.oidcIssuer),
  }),
  eventsSecret: config.eventsSecret,
  vocabulary: loadVocabulary(),
  events: postgresEventStore(pool),
  checkDatabase: async () => {
    await pool.query('SELECT 1');
  },
  logger: true,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}

await app.listen({ port: config.port, host: config.host });
