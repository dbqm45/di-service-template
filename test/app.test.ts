import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp, requireIdentity, requireRole } from '../src/app.ts';
import { createVerifier } from '../src/auth/oidc.ts';
import { loadVocabulary } from '../src/events/envelope.ts';
import { sign } from '../src/events/signature.ts';
import { memoryEventStore } from '../src/events/store.ts';
import { AUDIENCE, ISSUER, JWKS, SECRET, event, token } from './helpers.ts';

const setup = (over: { database?: () => Promise<void> } = {}) => {
  const events = memoryEventStore();
  const verifier = createVerifier({ issuer: ISSUER, audience: AUDIENCE, fetchJwks: async () => JWKS });
  const app = buildApp({
    version: '1.2.3',
    verifier,
    eventsSecret: SECRET,
    vocabulary: loadVocabulary(),
    events,
    checkDatabase: over.database ?? (async () => {}),
  });
  return { app, events, verifier };
};

const signed = (body: string, secret = SECRET) => {
  const ts = String(Math.floor(Date.now() / 1000));
  return { 'content-type': 'application/json', 'x-di-timestamp': ts, 'x-di-signature': sign(secret, ts, body) };
};

test('GET /health reports the version and the database', async () => {
  const { app } = setup();
  const res = await app.inject({ url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', version: '1.2.3', database: 'ok' });
  const down = setup({ database: async () => { throw new Error('no db'); } });
  const bad = await down.app.inject({ url: '/health' });
  assert.equal(bad.statusCode, 503);
  assert.equal(bad.json().database, 'unavailable');
});

test('GET /api/me needs a suite token', async () => {
  const { app } = setup();
  assert.equal((await app.inject({ url: '/api/me' })).statusCode, 401);
  const bad = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token({ aud: 'other' })}` } });
  assert.equal(bad.statusCode, 401);
  assert.match(bad.json().error, /another audience/);
  const ok = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token()}` } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().name, 'Ola Nowak');
  assert.deepEqual(ok.json().roles, ['editor']);
});

test('requireRole lets in only the named roles', async () => {
  const { app, verifier } = setup();
  app.get('/api/admin', { preHandler: [requireIdentity(verifier), requireRole('admin')] }, async () => ({ ok: true }));
  app.get('/api/edit', { preHandler: [requireIdentity(verifier), requireRole('editor', 'admin')] }, async () => ({ ok: true }));
  const auth = { authorization: `Bearer ${token()}` };
  assert.equal((await app.inject({ url: '/api/admin', headers: auth })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/edit', headers: auth })).statusCode, 200);
});

test('POST /api/events stores a signed contract event once', async () => {
  const { app, events } = setup();
  const body = JSON.stringify(event());
  const first = await app.inject({ method: 'POST', url: '/api/events', headers: signed(body), payload: body });
  assert.equal(first.statusCode, 202);
  assert.deepEqual(first.json(), { stored: true, duplicate: false });
  const again = await app.inject({ method: 'POST', url: '/api/events', headers: signed(body), payload: body });
  assert.deepEqual(again.json(), { stored: false, duplicate: true });
  assert.equal(events.events.length, 1);
});

test('POST /api/events refuses unsigned events and events outside the contract', async () => {
  const { app, events } = setup();
  const body = JSON.stringify(event());
  const unsigned = await app.inject({ method: 'POST', url: '/api/events', headers: { 'content-type': 'application/json' }, payload: body });
  assert.equal(unsigned.statusCode, 401);
  const wrong = await app.inject({ method: 'POST', url: '/api/events', headers: signed(body, 'another-secret-another-secret-123'), payload: body });
  assert.equal(wrong.statusCode, 401);
  const unknown = JSON.stringify(event({ type: 'made.up', extra: 1 }));
  const res = await app.inject({ method: 'POST', url: '/api/events', headers: signed(unknown), payload: unknown });
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.json().problems, ['unknown field extra', 'type made.up is not in the contract']);
  const broken = '{"id":';
  assert.equal((await app.inject({ method: 'POST', url: '/api/events', headers: signed(broken), payload: broken })).statusCode, 400);
  assert.equal(events.events.length, 0);
});

test('the vocabulary comes from the pinned contract', () => {
  const v = loadVocabulary();
  assert.equal(v.contractVersion, '0.16.0');
  assert.ok(v.types.includes('gate.decided'));
  assert.ok(v.sources.includes('pdi'));
});
