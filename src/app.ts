import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { TokenError, bearer, type Identity, type Verifier } from './auth/oidc.ts';
import { envelopeProblems, type Event, type Vocabulary } from './events/envelope.ts';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signatureProblem } from './events/signature.ts';
import type { EventStore } from './events/store.ts';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
    identity?: Identity;
  }
}

export interface AppInput {
  version: string;
  verifier: Verifier;
  eventsSecret: string;
  vocabulary: Vocabulary;
  events: EventStore;
  /** Throws when the database does not answer; GET /health reports it. */
  checkDatabase: () => Promise<void>;
  /** Fastify's logger; off in tests. */
  logger?: boolean;
}

const BODY_LIMIT = 1024 * 1024;

/**
 * Builds the service. Kept apart from `server.ts`, so tests drive it with `app.inject()` and no network.
 * Routes of the template: GET /health, GET /api/me (any signed-in person), POST /api/events (signed suite events).
 * Add the service's own routes here; protect them with `requireIdentity` and, where needed, `requireRole`.
 */
export function buildApp(input: AppInput): FastifyInstance {
  const app = Fastify({
    bodyLimit: BODY_LIMIT,
    logger: input.logger ? { redact: ['req.headers.authorization', `req.headers["${SIGNATURE_HEADER}"]`] } : false,
  });

  // The signature covers the exact bytes sent, so JSON bodies are kept as text before parsing.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body as string;
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('the body is not valid JSON'), { statusCode: 400 }), undefined);
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) request.log.error({ err }, 'request failed');
    void reply.code(status).send({ error: status === 500 ? 'internal error' : err.message });
  });

  app.get('/health', async (_request, reply) => {
    try {
      await input.checkDatabase();
      return { status: 'ok', version: input.version, database: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'degraded', version: input.version, database: 'unavailable' });
    }
  });

  app.get('/api/me', { preHandler: requireIdentity(input.verifier) }, async (request) => request.identity);

  app.post('/api/events', async (request, reply) => {
    const problem = signatureProblem({
      secret: input.eventsSecret,
      timestamp: headerOf(request, TIMESTAMP_HEADER),
      signature: headerOf(request, SIGNATURE_HEADER),
      body: request.rawBody ?? '',
    });
    if (problem) return reply.code(401).send({ error: problem });
    const problems = envelopeProblems(request.body, input.vocabulary);
    if (problems.length) return reply.code(422).send({ error: 'not a contract event', problems });
    const stored = await input.events.save(request.body as Event);
    return reply.code(202).send({ stored, duplicate: !stored });
  });

  return app;
}

const headerOf = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Accepts only requests with a valid access token from the suite identity service; sets `request.identity`. */
export function requireIdentity(verifier: Verifier) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearer(headerOf(request, 'authorization'));
    if (!token) {
      await reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'sign in through the suite identity service' });
      return;
    }
    try {
      request.identity = await verifier.verify(token);
    } catch (err) {
      if (!(err instanceof TokenError)) throw err;
      await reply.code(401).header('www-authenticate', 'Bearer error="invalid_token"').send({ error: err.message });
    }
  };
}

/** After `requireIdentity`: accepts only people with one of the roles of this application. */
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.identity?.roles.some((r) => roles.includes(r))) {
      await reply.code(403).send({ error: `needs one of the roles: ${roles.join(', ')}` });
    }
  };
}
