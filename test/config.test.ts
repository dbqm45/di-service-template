import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.ts';

const env = {
  DATABASE_URL: 'postgres://app:app@localhost:5432/app',
  OIDC_ISSUER: 'https://id.example.test/realms/suite/',
  OIDC_AUDIENCE: 'di-example',
  DI_EVENTS_SECRET: 'x'.repeat(32),
};

test('reads the configuration and trims the issuer', () => {
  const c = loadConfig(env, '0.1.0');
  assert.equal(c.oidcIssuer, 'https://id.example.test/realms/suite');
  assert.equal(c.port, 3000);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.databaseSsl, true);
  assert.deepEqual(c.oidcAuthorizedParties, []);
  assert.deepEqual(loadConfig({ ...env, OIDC_SERVICE_CLIENTS: 'di-channels' }).oidcServiceClients, ['di-channels']);
  assert.deepEqual(loadConfig({ ...env, OIDC_AUTHORIZED_PARTIES: 'a, b' }).oidcAuthorizedParties, ['a', 'b']);
});

test('names the variable that is missing or wrong', () => {
  assert.throws(() => loadConfig({ ...env, OIDC_AUDIENCE: '' }), (e: unknown) => e instanceof ConfigError && /OIDC_AUDIENCE/.test(e.message));
  assert.throws(() => loadConfig({ ...env, OIDC_ISSUER: 'http://id.example.test/realms/suite' }), /https/);
  assert.doesNotThrow(() => loadConfig({ ...env, OIDC_ISSUER: 'http://localhost:8080/realms/suite' }));
  assert.throws(() => loadConfig({ ...env, DI_EVENTS_SECRET: 'short' }), /32 characters/);
  assert.throws(() => loadConfig({ ...env, PORT: 'x' }), /PORT/);
});
