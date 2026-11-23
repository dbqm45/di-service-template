import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TokenError, bearer, createVerifier, discoveryJwks } from '../src/auth/oidc.ts';
import { AUDIENCE, ISSUER, JWKS, token } from './helpers.ts';

const verifier = (over: Partial<Parameters<typeof createVerifier>[0]> = {}) =>
  createVerifier({ issuer: ISSUER, audience: AUDIENCE, fetchJwks: async () => JWKS, ...over });

test('a valid token gives the person, organization and this application roles only', async () => {
  const id = await verifier().verify(token());
  assert.deepEqual(id, { sub: '5b0c2f9e-1f7a-4c1e-9f55-6d1a2b3c4d5e', name: 'Ola Nowak', organizations: ['acme'], roles: ['editor'] });
});

test('email is passed on only when the token carries it (DI3)', async () => {
  assert.equal((await verifier().verify(token({ email: 'ola@acme.test' }))).email, 'ola@acme.test');
  assert.equal('email' in (await verifier().verify(token())), false);
});

test('organization as an object keyed by alias is read too', async () => {
  const id = await verifier().verify(token({ organization: { acme: { id: '1' } } }));
  assert.deepEqual(id.organizations, ['acme']);
});

const rejects = async (t: string, message: RegExp, v = verifier()) => {
  await assert.rejects(v.verify(t), (err: unknown) => err instanceof TokenError && message.test(err.message));
};

test('tokens that must be refused', async () => {
  await rejects('abc', /not a JWT/);
  await rejects(token({}, { alg: 'HS256' }), /RS256/);
  await rejects(token({}, { alg: 'none' }), /RS256/);
  await rejects(token({}, { kid: 'other' }), /key the issuer does not publish/);
  await rejects(token({ iss: 'https://evil.test/realms/suite' }), /another issuer/);
  await rejects(token({ aud: 'account' }), /another audience/);
  await rejects(token({ exp: Math.floor(Date.now() / 1000) - 120 }), /expired/);
  await rejects(token({ nbf: Math.floor(Date.now() / 1000) + 600 }), /not valid yet/);
  await rejects(token({ sub: undefined }), /names no person/);
});

test('a changed payload breaks the signature', async () => {
  const [h, , s] = token().split('.');
  const forged = Buffer.from(JSON.stringify({ iss: ISSUER, aud: AUDIENCE, sub: 'x', exp: 9999999999 })).toString('base64url');
  await rejects(`${h}.${forged}.${s}`, /signature does not match/);
});

test('keys are fetched once and cached', async () => {
  let calls = 0;
  const v = verifier({ fetchJwks: async () => (calls++, JWKS) });
  await v.verify(token());
  await v.verify(token());
  assert.equal(calls, 1);
});

test('unreadable keys give a clear error, not a crash', async () => {
  await rejects(token(), /could not be read/, verifier({ fetchJwks: async () => { throw new Error('down'); } }));
});

test('discovery checks the issuer and keeps jwks_uri on the issuer host', async () => {
  const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const ok: typeof fetch = async (url) =>
    String(url).endsWith('openid-configuration') ? answer({ issuer: ISSUER, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` }) : answer({ keys: JWKS });
  assert.equal((await discoveryJwks(ISSUER, ok)()).length, 1);
  const elsewhere: typeof fetch = async () => answer({ issuer: ISSUER, jwks_uri: 'https://evil.test/certs' });
  await assert.rejects(discoveryJwks(ISSUER, elsewhere)(), /another host/);
  const wrongIssuer: typeof fetch = async () => answer({ issuer: 'https://other.test', jwks_uri: `${ISSUER}/certs` });
  await assert.rejects(discoveryJwks(ISSUER, wrongIssuer)(), /does not match/);
});

test('bearer reads only a well-formed Authorization header', () => {
  assert.equal(bearer('Bearer a.b.c'), 'a.b.c');
  assert.equal(bearer('bearer a.b.c'), null);
  assert.equal(bearer('Basic abc'), null);
  assert.equal(bearer(undefined), null);
});
