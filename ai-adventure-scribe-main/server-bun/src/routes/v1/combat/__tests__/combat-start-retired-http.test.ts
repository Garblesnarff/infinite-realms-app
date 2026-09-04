import { describe, expect, it } from 'bun:test';

// The retired route is imported through the normal initiative router. These values only satisfy
// eager environment validation; the 410 handler must not touch the database or combat services.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
process.env.PORT ??= '3000';
process.env.CORS_ORIGIN ??= 'http://localhost:3000';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

const authenticateRequest = async (request: Request) =>
  request.headers.get('authorization') === 'Bearer valid-token'
    ? { user: { userId: 'user-owner', email: 'owner@example.test', plan: 'free' }, error: null }
    : { user: null, error: 'Unauthorized' };

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { createInitiativeRoutes } = await import('../initiative.js');

const app = createRequestPipelineApp().use(
  createInitiativeRoutes({ authenticateRequest: authenticateRequest as never }),
);

const request = (authorized: boolean, body?: string) =>
  app.handle(
    new Request(`http://localhost/sessions/${SESSION_ID}/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorized ? { authorization: 'Bearer valid-token' } : {}),
      },
      ...(body === undefined ? {} : { body }),
    }),
  );

describe('retired POST /v1/combat/sessions/:sessionId/start', () => {
  it('rejects unauthenticated callers before the retirement response', async () => {
    const response = await request(false);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 410 Gone without parsing or executing the legacy snapshot start', async () => {
    const response = await request(true, 'not-json');

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'Combat start endpoint retired; use /v1/combat/sessions/:sessionId/enter',
    });
  });
});
