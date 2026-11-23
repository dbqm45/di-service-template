import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * Verifies access tokens from the suite identity service (Keycloak, ADR 17 in dbqm45/pdi): an RS256 JWT signed with
 * a key from the issuer's JWKS. Only the configured issuer and RS256 are trusted, never a key or algorithm the token
 * names itself. Keys are found through OpenID discovery, cached for an hour; a token signed with an unknown key
 * refetches them at most once every 5 minutes. Same rules as ShipScope's GitHub OIDC verifier, without dependencies.
 *
 * What the token carries (ADR 17 §2.2, §2.6): `sub` (the suite id of a person or an agent), a display name, the
 * organization, this application's roles, `email` only for applications given the email scope (DI3), and for an
 * agent `kind: agent` with its human `owner` (DI4).
 *
 * Keycloak adds to `aud` every application the person has roles in, so a token issued to another application would
 * pass the audience check. A person's token is therefore accepted only when it was issued to this application
 * (`azp`), or to one of `authorizedParties`; an agent's token comes from the agent's own client (`agent-…`).
 */
export interface Identity {
  /** Stable id in the suite (person or agent); the value of `actor.id` in the contract. */
  sub: string;
  kind: 'person' | 'agent';
  /** For an agent: `sub` of the person responsible for it (DI4). */
  owner?: string;
  name: string;
  /** Only when the identity service gives this application the email scope (DI3). */
  email?: string;
  /** Organization aliases the person belongs to (Keycloak Organizations). */
  organizations: string[];
  /** Roles of this application (`resource_access[<audience>].roles`). */
  roles: string[];
}

/** The token is not valid for this service (answer 401); the message says why, never the token. */
export class TokenError extends Error {}

export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  use?: string;
  alg?: string;
}

export type FetchJwks = () => Promise<Jwk[]>;

const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_REFETCH_MS = 5 * 60 * 1000;
const JWKS_RETRY_MS = 10 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const SEGMENT = /^[A-Za-z0-9_-]+$/;
const MAX_TEXT = 300;

const decode = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('the token is not valid JSON');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT ? value : undefined);
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter((v): v is string => v !== undefined) : []);

/**
 * Organization claim of Keycloak Organizations: a list of aliases, or an object keyed by alias when organization
 * attributes are added. [Not verified against a running Keycloak 26; check in step 14.]
 */
const organizationsOf = (claim: unknown): string[] => {
  if (Array.isArray(claim)) return texts(claim);
  if (isRecord(claim)) return Object.keys(claim).map(text).filter((v): v is string => v !== undefined);
  return [];
};

/** Reads the issuer's signing keys through OpenID discovery. */
export function discoveryJwks(issuer: string, fetchImpl: typeof fetch = fetch): FetchJwks {
  const get = async (url: string): Promise<unknown> => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
    return res.json();
  };
  return async () => {
    const meta = await get(`${issuer}/.well-known/openid-configuration`);
    if (!isRecord(meta) || meta.issuer !== issuer || typeof meta.jwks_uri !== 'string') throw new Error('the discovery document does not match the issuer');
    const origin = new URL(issuer).origin;
    if (new URL(meta.jwks_uri).origin !== origin) throw new Error('jwks_uri is on another host than the issuer');
    const body = await get(meta.jwks_uri);
    if (!isRecord(body) || !Array.isArray(body.keys)) throw new Error('the keys are not a JWKS');
    return body.keys.filter(
      (k): k is Jwk => isRecord(k) && k.kty === 'RSA' && typeof k.kid === 'string' && typeof k.n === 'string' && typeof k.e === 'string' && (k.use === undefined || k.use === 'sig'),
    );
  };
}

export interface Verifier {
  verify(token: string): Promise<Identity>;
}

export function createVerifier(input: {
  issuer: string;
  audience: string;
  fetchJwks: FetchJwks;
  /** Other clients whose person tokens this service accepts (e.g. its web front end); this audience always. */
  authorizedParties?: string[];
  now?: () => number;
}): Verifier {
  const { issuer, audience, fetchJwks } = input;
  const parties = new Set([audience, ...(input.authorizedParties ?? [])]);
  const now = input.now ?? Date.now;
  let keys = new Map<string, KeyObject>();
  let fetchedAt = 0;
  let attemptedAt = -Infinity;
  let pending: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    if (!pending) {
      attemptedAt = now();
      pending = fetchJwks()
        .then((list) => {
          keys = new Map(list.map((jwk) => [jwk.kid, createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' })]));
          fetchedAt = now();
        })
        .finally(() => {
          pending = null;
        });
    }
    await pending;
  };

  const keyFor = async (kid: string): Promise<KeyObject | undefined> => {
    const due = !fetchedAt || now() - fetchedAt > JWKS_TTL_MS || (!keys.has(kid) && now() - fetchedAt > JWKS_REFETCH_MS);
    if (due && (pending || now() - attemptedAt > JWKS_RETRY_MS)) {
      try {
        await refresh();
      } catch (err) {
        if (!keys.size) throw new TokenError(`the signing keys could not be read: ${(err as Error).message}`);
      }
    } else if (due && !keys.size) {
      throw new TokenError('the signing keys could not be read; try again shortly');
    }
    return keys.get(kid);
  };

  return {
    async verify(token: string): Promise<Identity> {
      const parts = token.split('.');
      if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) throw new TokenError('not a JWT');
      const [head, body, sig] = parts as [string, string, string];
      const header = decode(head);
      if (!isRecord(header) || header.alg !== 'RS256') throw new TokenError('the token must be signed with RS256');
      if (typeof header.kid !== 'string' || !header.kid) throw new TokenError('the token names no key');
      const key = await keyFor(header.kid);
      if (!key) throw new TokenError('the token is signed with a key the issuer does not publish');
      if (!verifySignature('sha256', Buffer.from(`${head}.${body}`), key, Buffer.from(sig, 'base64url'))) {
        throw new TokenError('the token signature does not match');
      }
      const claims = decode(body);
      if (!isRecord(claims)) throw new TokenError('the token has no claims');
      if (claims.iss !== issuer) throw new TokenError('the token is from another issuer');
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!audiences.includes(audience)) throw new TokenError(`the token is for another audience; request it for ${audience}`);
      const seconds = Math.floor(now() / 1000);
      if (typeof claims.exp !== 'number' || claims.exp < seconds - CLOCK_SKEW_SECONDS) throw new TokenError('the token has expired');
      for (const claim of ['nbf', 'iat'] as const) {
        const value = claims[claim];
        if (value !== undefined && (typeof value !== 'number' || value > seconds + CLOCK_SKEW_SECONDS)) throw new TokenError('the token is not valid yet');
      }
      const sub = text(claims.sub);
      if (!sub) throw new TokenError('the token names no person');
      const azp = text(claims.azp);
      const agent = claims.kind === 'agent';
      const owner = text(claims.owner);
      if (agent) {
        if (!azp?.startsWith('agent-')) throw new TokenError('an agent token must come from an agent client');
        if (!owner) throw new TokenError('the agent has no owner');
      } else {
        if (claims.kind !== undefined) throw new TokenError('unknown kind of account');
        if (!azp || !parties.has(azp)) throw new TokenError('the token was issued to another application');
      }
      const access = isRecord(claims.resource_access) ? claims.resource_access[audience] : undefined;
      const identity: Identity = {
        sub,
        kind: agent ? 'agent' : 'person',
        name: text(claims.name) ?? text(claims.preferred_username) ?? sub,
        organizations: organizationsOf(claims.organization),
        roles: isRecord(access) ? texts(access.roles) : [],
      };
      if (agent) identity.owner = owner;
      const email = text(claims.email);
      if (email && !agent) identity.email = email;
      return identity;
    },
  };
}

/** The bearer token of an Authorization header, or null. */
export function bearer(header: string | undefined): string | null {
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header ?? '');
  return m?.[1] ?? null;
}
