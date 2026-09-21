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
  it('no bearer and no body currently returns 422 (desired 401)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/telemetry/client-failure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Desired: 401. TypeBox body schema currently runs before requireAuth (#2120).
    expect(response.status).toBe(422);
  });

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
    const json = (await response.json()) as { error?: string };
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

  it('accepts combat intent failures', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'combat_intent_failed',
        error: 'encounter=enc-1; Combat action rejected (500)',
      }),
    );
    expect(response.status).toBe(204);
  });

  it('accepts stale client detections', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'stale_client_detected',
        sessionId: 'sess-1',
        error: 'running=old; served=new',
      }),
    );
    expect(response.status).toBe(204);
  });

  it('accepts malformed WebSocket frame reports', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'malformed_ws_frame',
        sessionId: 'sess-1',
        error: 'channel=session-story; count=2; Unexpected token',
      }),
    );
    expect(response.status).toBe(204);
  });

  it('accepts missing starter campaign id reports', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'missing_starter_campaign_id',
        sessionId: 'sess-1',
        error: 'Missing required starter_campaign_id for game session',
      }),
    );
    expect(response.status).toBe(204);
  });

  it('accepts invalid ability score key reports', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'invalid_ability_score_key',
        error: 'Unrecognized ability score key "LUCK" in starter template "The Apprentice".',
      }),
    );
    expect(response.status).toBe(204);
  });
});
