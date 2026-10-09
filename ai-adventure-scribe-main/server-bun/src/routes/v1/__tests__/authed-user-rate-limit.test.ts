/**
 * Per-user rate limits must count routes that authenticate (#193 step 4).
 *
 * Before this change, spells authenticated inside each handler, so planRateLimit never saw
 * `user` and only the per-IP bucket ever filled. The control case reproduces that wiring. The
 * real route, mounted through the requireUserAuth plugin, must fill the per-user bucket.
 *
 * Client IPs rotate through X-Forwarded-For, so the per-IP bucket never fills: a 429 with
 * `scope: 'user'` can only come from the per-user bucket.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { resetCircuitBreakersForTests } from '../../../utils/circuit-breaker.js';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://localhost:5432/test',
  NODE_ENV: 'test',
  TRUST_PROXY_HEADERS: 'true',
});

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/supabase.js', () => ({ supabaseService: {} }));
// Any bearer token is a valid free-plan user whose id is the token.
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (!token) return { user: null, error: 'Unauthorized' };
    return { user: { userId: token, email: `${token}@example.test`, plan: 'free' }, error: null };
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { planRateLimit } = await import('../../../middleware/rate-limit.js');
const { spellsRoutes } = await import('../spells.js');

// The free default per-user limit is 60 a minute (rate-limit.ts, `default`).
const FREE_USER_LIMIT = 60;
// The free default per-IP limit is also 60 a minute.
const FREE_IP_LIMIT = 60;

/** Pre-change wiring: the limiter runs, but the handler authenticates on its own. */
const controlApp = createRequestPipelineApp().use(
  new Elysia({ prefix: '/v1/control' }).use(planRateLimit('default')).get('/classes', () => []),
);
const realApp = createRequestPipelineApp().use(spellsRoutes);

function classesRequest(prefix: string, token: string | null, clientIp: string): Request {
  const headers: Record<string, string> = { 'x-forwarded-for': clientIp };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost${prefix}/classes`, { headers });
}

let counter = 0;
const freshUser = (): string => {
  counter += 1;
  return `rate-user-${process.pid}-${counter}`;
};

beforeAll(() => {
  resetCircuitBreakersForTests();
});
beforeEach(() => {
  resetCircuitBreakersForTests();
});

describe('per-user rate limit on authenticated routes (#193 step 4)', () => {
  it('control: with the handler authenticating inside, the per-user bucket never fills', async () => {
    const user = freshUser();
    const statuses: number[] = [];
    for (let i = 0; i < FREE_USER_LIMIT + 1; i += 1) {
      const res = await controlApp.handle(classesRequest('/v1/control', user, `10.1.0.${i}`));
      statuses.push(res.status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('two requests from the same user count against the per-user bucket, not the IP bucket', async () => {
    const user = freshUser();
    // 60 requests from 60 different IPs: each IP bucket sees one request.
    for (let i = 0; i < FREE_USER_LIMIT; i += 1) {
      const res = await realApp.handle(classesRequest('/v1/spells', user, `10.2.0.${i}`));
      expect(res.status).toBe(200);
    }
    // The 61st request, from a fresh IP, is refused by the user bucket.
    const refused = await realApp.handle(classesRequest('/v1/spells', user, '10.2.9.9'));
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { error: { details: { scope: string } } };
    expect(body.error.details.scope).toBe('user');
  });

  it('an unauthenticated request still gets the same 401 as before', async () => {
    const res = await realApp.handle(classesRequest('/v1/spells', null, '10.3.0.1'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('unauthenticated requests count against the per-IP bucket before the 401', async () => {
    const clientIp = '10.4.0.1';
    // Each request is refused by the guard, but planRateLimit counts it first.
    for (let i = 0; i < FREE_IP_LIMIT; i += 1) {
      const res = await realApp.handle(classesRequest('/v1/spells', null, clientIp));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
    }
    // The request after the limit is refused by the IP bucket, not the auth guard.
    const refused = await realApp.handle(classesRequest('/v1/spells', null, clientIp));
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { error: { details: { scope: string } } };
    expect(body.error.details.scope).toBe('ip');
  });
});
