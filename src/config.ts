/**
 * Configuration from environment variables, read once at start. A missing required value stops the service with a
 * message that names the variable; values are never logged. The list with examples is in `.env.example`.
 */
export interface Config {
  port: number;
  host: string;
  /** Postgres connection string; TLS unless DATABASE_SSL=false (a local container). */
  databaseUrl: string;
  databaseSsl: boolean;
  /** Issuer of the suite identity service (Keycloak realm), e.g. https://id.example.com/realms/suite. */
  oidcIssuer: string;
  /** This service's client id in the identity service; tokens must name it in `aud`. */
  oidcAudience: string;
  /** Other clients whose person tokens are accepted (OIDC_AUTHORIZED_PARTIES, comma-separated). */
  oidcAuthorizedParties: string[];
  /** Suite applications whose service accounts may call this service (OIDC_SERVICE_CLIENTS, comma-separated). */
  oidcServiceClients: string[];
  /** Shared secret for signed events between suite services (X-DI-Signature). */
  eventsSecret: string;
  /** Version reported by GET /health. */
  version: string;
}

export class ConfigError extends Error {}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is not set (see .env.example)`);
  return value;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, version = '0.0.0'): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ConfigError('PORT must be a port number');
  const issuer = required(env, 'OIDC_ISSUER').replace(/\/+$/, '');
  if (!/^https:\/\//.test(issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${issuer}/`)) {
    throw new ConfigError('OIDC_ISSUER must be an https:// address (http:// only for localhost)');
  }
  const eventsSecret = required(env, 'DI_EVENTS_SECRET');
  if (eventsSecret.length < 32) throw new ConfigError('DI_EVENTS_SECRET must have at least 32 characters');
  return {
    port,
    host: env.HOST?.trim() || '127.0.0.1',
    databaseUrl: required(env, 'DATABASE_URL'),
    databaseSsl: env.DATABASE_SSL !== 'false',
    oidcIssuer: issuer,
    oidcAudience: required(env, 'OIDC_AUDIENCE'),
    oidcAuthorizedParties: (env.OIDC_AUTHORIZED_PARTIES ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    oidcServiceClients: (env.OIDC_SERVICE_CLIENTS ?? '').split(',').map((p) => p.trim()).filter(Boolean),
    eventsSecret,
    version,
  };
}
