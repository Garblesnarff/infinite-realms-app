import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// Captures the object-form info log lines so tests can assert what the route
// actually wrote to the server log (#2515).
const loggedInfo: Record<string, unknown>[] = [];
const capturingLogger = {
  debug: () => {},
  info: (entry: unknown) => {
    if (entry && typeof entry === 'object') loggedInfo.push(entry as Record<string, unknown>);
  },
  warn: () => {},
  error: () => {},
};

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
mock.module('../../../lib/logger.js', () => ({ logger: capturingLogger }));

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
  beforeEach(() => {
    loggedInfo.length = 0;
  });

  it('no bearer and no body returns 401 (auth runs before body validation, #2120)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/telemetry/client-failure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    // The route validates the payload in the handler (zod), so the scoped
    // requireAuth resolve runs first and unauthenticated callers always 401.
    expect(response.status).toBe(401);
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

  it('accepts unhandled promise rejection and React error boundary reports (#2515)', async () => {
    for (const kind of ['unhandled_promise_rejection', 'react_error_boundary']) {
      const response = await app.handle(authedRequest({ kind, error: 'boom' }));
      expect(response.status).toBe(204);
    }
  });

  it('rejects a malformed payload (missing kind) with 400', async () => {
    const response = await app.handle(authedRequest({ sessionId: 'sess-1' }));
    expect(response.status).toBe(400);
  });

  it('logs a posted failure at info level with the session id and failure fields (#2515)', async () => {
    // Shape exactly as the real client producer sends it
    // (`userDataApi.reportClientFailure` in src/services/user-data-api.ts).
    const response = await app.handle(
      authedRequest({
        kind: 'react_error_boundary',
        sessionId: 'sess-9',
        error: 'Cannot read properties of undefined (reading "hp")',
        message: 'Cannot read properties of undefined (reading "hp")',
        component: 'GameContent',
        route: '/app/game/sess-9',
        bundle: '2026.10.03-abc123',
        clientTimestamp: '2026-10-02T12:04:07.000Z',
      }),
    );
    expect(response.status).toBe(204);

    const line = loggedInfo.find((entry) => entry.msg === 'CLIENT_FAILURE');
    expect(line).toEqual({
      msg: 'CLIENT_FAILURE',
      sessionId: 'sess-9',
      userId: 'user-1',
      kind: 'react_error_boundary',
      message: 'Cannot read properties of undefined (reading "hp")',
      component: 'GameContent',
      route: '/app/game/sess-9',
      bundle: '2026.10.03-abc123',
      clientTimestamp: '2026-10-02T12:04:07.000Z',
    });
  });

  it('truncates the logged message to 500 chars (#2515)', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'unhandled_promise_rejection',
        message: 'x'.repeat(600),
      }),
    );
    expect(response.status).toBe(204);

    const line = loggedInfo.find((entry) => entry.msg === 'CLIENT_FAILURE');
    expect(typeof line?.message).toBe('string');
    expect((line?.message as string).length).toBe(500);
  });

  it('accepts a 5000-char message and error, and still logs 500 chars (#2515)', async () => {
    // A failure whose message is an HTML error page or serialized response must
    // not be dropped whole for exceeding a length cap.
    const response = await app.handle(
      authedRequest({
        kind: 'unhandled_promise_rejection',
        sessionId: 'sess-9',
        message: 'y'.repeat(5_000),
        error: 'z'.repeat(5_000),
      }),
    );
    expect(response.status).toBe(204);

    const line = loggedInfo.find((entry) => entry.msg === 'CLIENT_FAILURE');
    expect(line?.sessionId).toBe('sess-9');
    expect((line?.message as string).length).toBe(500);
  });

  it('falls back to the legacy error field for the logged message (#2515)', async () => {
    const response = await app.handle(
      authedRequest({
        kind: 'scene_state_fetch_failed',
        sessionId: 'sess-1',
        error: 'fetch returned null',
      }),
    );
    expect(response.status).toBe(204);

    const line = loggedInfo.find((entry) => entry.msg === 'CLIENT_FAILURE');
    expect(line?.message).toBe('fetch returned null');
    expect(line?.sessionId).toBe('sess-1');
  });
});
