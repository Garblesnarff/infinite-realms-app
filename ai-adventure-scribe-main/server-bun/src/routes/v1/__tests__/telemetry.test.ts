import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// Mock env (pulled in transitively by ../../../middleware/auth.js)
mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));

// Mock logger everywhere it's imported from, so tests stay quiet and assertable.
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

// Mock auth: only 'Bearer valid-user-token' is accepted.
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

// The route calls through to the real alerting module; ensure it never reaches the network
// during tests by leaving SLACK_ALERT_WEBHOOK_URL unset.
delete process.env.SLACK_ALERT_WEBHOOK_URL;

const { telemetryRoutes } = await import('../telemetry.js');
const app = new Elysia().use(telemetryRoutes);

const authedRequest = (body: unknown) =>
  new Request('http://localhost/v1/telemetry/client-failure', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      authorization: 'Bearer valid-user-token',
    },
    body: JSON.stringify(body),
  });

describe('POST /v1/telemetry/client-failure', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/telemetry/client-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'lore_injection_failed' }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it('rejects a kind outside the allowlist with 400', async () => {
    const response = await app.handle(
      authedRequest({ kind: 'not_a_real_kind', sessionId: 'sess-1' }),
    );
    expect(response.status).toBe(400);
    const json: any = await response.json();
    expect(json.error).toContain('Invalid kind');
  });

  it('accepts an allowlisted kind and returns 204', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'scene_state_fetch_failed',
        sessionId: 'sess-1',
        error: 'fetch returned null',
      }),
    );
    expect(response.status).toBe(204);
  });

  it('accepts the other allowlisted kind without optional fields', async () => {
    const response = await app.handle(authedRequest({ kind: 'lore_injection_failed' }));
    expect(response.status).toBe(204);
  });
});
