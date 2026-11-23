import { generateKeyPairSync, sign as rsaSign } from 'node:crypto';
import type { Jwk } from '../src/auth/oidc.ts';

export const ISSUER = 'https://id.example.test/realms/suite';
export const AUDIENCE = 'di-example';
export const SECRET = 'test-secret-that-is-at-least-32-chars';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
export const KID = 'key-1';
export const JWKS: Jwk[] = [{ kid: KID, kty: jwk.kty, n: jwk.n, e: jwk.e, use: 'sig' }];

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An RS256 token like the identity service issues; `claims` override the defaults. */
export function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: KID, ...header });
  const body = b64({
    iss: ISSUER,
    aud: [AUDIENCE, 'account'],
    sub: '5b0c2f9e-1f7a-4c1e-9f55-6d1a2b3c4d5e',
    azp: AUDIENCE,
    name: 'Ola Nowak',
    iat: now,
    exp: now + 300,
    organization: ['acme'],
    resource_access: { [AUDIENCE]: { roles: ['editor'] }, other: { roles: ['admin'] } },
    ...claims,
  });
  const sig = rsaSign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

/** An agent token as Keycloak issues it for a service account (checked against Keycloak 26.4 on 2026-11-23). */
export const agentToken = (claims: Record<string, unknown> = {}) =>
  token({
    sub: '16eda11b-ba24-4683-9a20-84f41bf80056',
    azp: 'agent-tomasz-acme',
    name: undefined,
    preferred_username: 'service-account-agent-tomasz-acme',
    kind: 'agent',
    owner: '5b0c2f9e-1f7a-4c1e-9f55-6d1a2b3c4d5e',
    client_id: 'agent-tomasz-acme',
    resource_access: { [AUDIENCE]: { roles: ['viewer'] } },
    ...claims,
  });

/** A service account token of another suite application, as Keycloak 26.4 issues it (client credentials). */
export const serviceToken = (client = 'di-channels', claims: Record<string, unknown> = {}) =>
  token({
    sub: '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0',
    azp: client,
    client_id: client,
    preferred_username: `service-account-${client}`,
    name: undefined,
    email: undefined,
    organization: undefined,
    resource_access: { [AUDIENCE]: { roles: ['people-reader'] } },
    ...claims,
  });

export const event = (over: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  type: 'gate.decided',
  occurred_at: '2026-11-23T10:00:00Z',
  source: 'pdi',
  contract_version: '0.16.0',
  payload: { change: 'CHG-1' },
  ...over,
});
