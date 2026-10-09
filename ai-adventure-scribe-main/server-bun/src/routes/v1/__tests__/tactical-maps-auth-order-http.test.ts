import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
  PORT: process.env.PORT ?? '3000',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? 'test-workos-key',
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? 'test-workos-client',
});

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

const { requireAuth } = await import('../../../middleware/auth.js');
const { createTacticalMapRoutes } = await import('../tactical-maps.js');

const app = new Elysia().use(
  createTacticalMapRoutes({
    auth: requireAuth,
    sessionOwnership: (async () => ({
      success: true as const,
      session: { id: 'session-1' },
    })) as never,
    activeMapLoader: async () => null,
    dmTacticalActions: (async () => ({ results: [], appliedDeltas: [], degraded: [] })) as never,
  }),
);

describe('removed POST /v1/sessions/:id/tactical-map/action (#2685 step 1)', () => {
  it('no bearer and no body returns 404 after route removal', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/tactical-map/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(response.status).toBe(404);
  });
});
