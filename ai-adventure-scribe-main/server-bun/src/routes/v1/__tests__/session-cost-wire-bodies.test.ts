/**
 * #2269: the bodies the client posts for in-session voice and scene images, through the real
 * request pipeline, the real routes and the real `AIUsageService`. The ElevenLabs and OpenRouter
 * calls are stubbed at `fetch`; auth is stubbed; the database driver records the SQL it is given,
 * so the assertion is on the `ai_usage` INSERT itself: `session_id` is the session in the body,
 * and null when the client sent none (portraits, campaign covers).
 *
 * The bodies are the shared fixture the client tests assert the client code sends
 * (`src/__tests__/session-cost-wire-bodies.test.ts`), AGENTS.md §4, pattern #2286.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import {
  COST_WIRE_CASES,
  PORTRAIT_IMAGE_WITHOUT_SESSION,
  SCENE_IMAGE_IN_SESSION,
  VOICE_IN_SESSION,
  type CostWireCase,
} from '../../../../../shared/test-fixtures/session-cost-wire-bodies';

import type { TtsRouteOptions } from '../tts.js';

const envKeys = [
  'DATABASE_URL',
  'NODE_ENV',
  'OPENROUTER_API_KEY',
  'OPENROUTER_IMAGE_MODEL',
  'ELEVENLABS_API_KEY',
  'ELEVEN_LABS_API_KEY',
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test.invalid/unused',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'test-openrouter-key',
  OPENROUTER_IMAGE_MODEL: 'google/gemini-3.1-flash-image',
  ELEVENLABS_API_KEY: 'test-elevenlabs-key',
});

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

type SqlCall = { text: string; values: unknown[] };
const sqlCalls: SqlCall[] = [];

// A tagged-template stand-in for postgres.js that records every statement. It has no `begin`, so
// the quota check takes its in-memory path and only the usage INSERT reaches the recorded calls.
const fakeSql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
  sqlCalls.push({ text: strings.join('?'), values });
  return [];
};

mock.module('../../../lib/db.js', () => ({ sql: fakeSql }));
mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: noopLogger,
  combatLogger: noopLogger,
  spellLogger: noopLogger,
  progressionLogger: noopLogger,
  errorLogSerializers: {},
  default: noopLogger,
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer cost-user'
      ? { user: { userId: 'cost-user', email: 'cost@example.test', plan: 'pro' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { imageRoutes } = await import('../images.js');
const { createTtsRoutes } = await import('../tts.js');

const testAuth = new Elysia({ name: 'test-cost-auth' }).resolve({ as: 'scoped' }, ({ request }) => {
  if (request.headers.get('authorization') !== 'Bearer cost-user') {
    return status(401, { error: 'Unauthorized' });
  }
  return { user: { userId: 'cost-user', email: 'cost@example.test', plan: 'pro' } };
});

// The production composition: the request pipeline, then the routes. Only the voice route's auth
// and limiter are injected (its own options); the usage service is the real one.
const app = createRequestPipelineApp()
  .use(imageRoutes)
  .use(
    createTtsRoutes({
      auth: testAuth as unknown as TtsRouteOptions['auth'],
      rateLimit: new Elysia({ name: 'test-cost-limit' }) as unknown as TtsRouteOptions['rateLimit'],
    }),
  );

const providerRequests: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  sqlCalls.length = 0;
  providerRequests.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    providerRequests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    if (url.startsWith('https://openrouter.ai/')) {
      return new Response(
        JSON.stringify({
          choices: [
            { message: { images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 1290 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('audio-bytes', { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }) as unknown as typeof fetch;
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const post = (testCase: CostWireCase): Promise<Response> =>
  app.handle(
    new Request(`http://localhost${testCase.path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer cost-user', 'content-type': 'application/json' },
      body: JSON.stringify(testCase.wireBody),
    }),
  );

/** The `ai_usage` rows the request wrote: the detail INSERT is the one that names session_id. */
const usageRows = (): SqlCall[] =>
  sqlCalls.filter(
    (call) => call.text.includes('INSERT INTO ai_usage') && call.text.includes('session_id'),
  );

describe('client wire bodies through the real routes (#2269)', () => {
  for (const testCase of COST_WIRE_CASES) {
    it(`${testCase.name}: the usage row carries ${testCase.expectedSessionId ?? 'no session'}`, async () => {
      const response = await post(testCase);

      expect(response.status).toBe(200);
      const rows = usageRows();
      expect(rows).toHaveLength(1);
      // session_id is the last column of the INSERT; the user is the second.
      expect(rows[0]?.values.at(-1)).toBe(testCase.expectedSessionId);
      expect(rows[0]?.values).toContain('cost-user');
    });
  }

  it('the image route accepts the scene body and returns the image', async () => {
    const response = await post(SCENE_IMAGE_IN_SESSION);

    expect(await response.json()).toEqual({ image: 'aGVsbG8=' });
    const [row] = usageRows();
    expect(row?.values).toContain('image');
    expect(row?.values).toContain('openrouter');
  });

  it('the portrait body is accepted with no session key and writes a null session_id', async () => {
    expect(PORTRAIT_IMAGE_WITHOUT_SESSION.wireBody).not.toHaveProperty('sessionId');

    const response = await post(PORTRAIT_IMAGE_WITHOUT_SESSION);

    expect(response.status).toBe(200);
    expect(usageRows()[0]?.values.at(-1)).toBeNull();
  });

  it('the voice route does not forward sessionId to ElevenLabs, and audio comes back', async () => {
    const response = await post(VOICE_IN_SESSION);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('audio-bytes');
    const { sessionId: _sessionId, ...providerBody } = VOICE_IN_SESSION.wireBody;
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.url).toContain('api.elevenlabs.io');
    expect(providerRequests[0]?.body).toEqual(providerBody);
  });
});
