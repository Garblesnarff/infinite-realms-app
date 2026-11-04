import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import type { TtsRouteOptions } from '../tts.js';

// #1348: the premium proxy never logged provider failures, so a run of 502s
// could not be told apart from quota (402), auth (401) or a bad voice (422).
// These tests drive the real route with a failing upstream and assert the
// mapped status, the server-side log entry, and that nothing is charged.

const envKeys = [
  'DATABASE_URL',
  'PORT',
  'CORS_ORIGIN',
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'NODE_ENV',
  'ELEVENLABS_API_KEY',
  'ELEVEN_LABS_API_KEY',
  'RATE_LIMIT_VOICE_IP_FREE',
  'RATE_LIMIT_VOICE_USER_FREE',
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  PORT: '3000',
  CORS_ORIGIN: 'http://localhost:3000',
  WORKOS_API_KEY: 'test-workos-key',
  WORKOS_CLIENT_ID: 'test-workos-client',
  NODE_ENV: 'test',
  ELEVENLABS_API_KEY: 'server-test-provider-key',
  RATE_LIMIT_VOICE_IP_FREE: '100',
  RATE_LIMIT_VOICE_USER_FREE: '1',
});

const logged: Array<Record<string, unknown>> = [];
const logger = {
  debug: () => {},
  info: () => {},
  warn: (obj: unknown) => {
    logged.push(obj as Record<string, unknown>);
  },
  error: (obj: unknown) => {
    logged.push(obj as Record<string, unknown>);
  },
};

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-workos-client' } }));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({ allowed: true }),
    assertUsageStoreAvailable: async () => {},
    getQuotaStatus: async () => ({ remaining: 1000 }),
    recordProviderUsage: async () => {},
  },
  elevenLabsCharacterCostUsd: (characters: number) => (characters * 0.05) / 1000,
  voiceQuotaUnits: (characters: number) => Math.ceil(characters / 100),
}));

const { createTtsRoutes } = await import('../tts.js');

const testUsers: Record<string, string> = {
  'Bearer tts-upstream-user': 'tts-upstream-user',
};

const testAuth = new Elysia({ name: 'test-tts-upstream-auth' }).resolve(
  { as: 'scoped' },
  ({ request }) => {
    const userId = testUsers[request.headers.get('authorization') || ''];
    if (!userId) return status(401, { error: 'Unauthorized' });

    return { user: { userId, email: `${userId}@example.test`, plan: 'free' } };
  },
);

const noopRateLimit = new Elysia({ name: 'test-tts-noop-rate-limit' });

function makeApp(fetchImpl: TtsRouteOptions['fetchImpl']): {
  app: { handle: (request: Request) => Promise<Response> };
  calls: { consume: number; record: number };
} {
  const calls = { consume: 0, record: 0 };
  const app = new Elysia().use(
    createTtsRoutes({
      auth: testAuth as unknown as TtsRouteOptions['auth'],
      rateLimit: noopRateLimit as unknown as TtsRouteOptions['rateLimit'],
      usageService: {
        assertUsageStoreAvailable: async () => {},
        getQuotaStatus: async () => ({ remaining: 1000 }),
        checkQuotaAndConsume: async () => {
          calls.consume += 1;
          return { allowed: true, remaining: 1, resetAt: '' };
        },
        recordProviderUsage: async () => {
          calls.record += 1;
        },
      } as unknown as TtsRouteOptions['usageService'],
      fetchImpl,
    }),
  );
  return { app, calls };
}

function request(): Request {
  return new Request('http://localhost/v1/ai-proxy/voice/voice-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer tts-upstream-user',
    },
    body: JSON.stringify({
      text: 'The lantern flickers.',
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
}

beforeEach(() => {
  logged.length = 0;
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('POST /v1/ai-proxy/voice/:voiceId upstream failures (#1348)', () => {
  it('maps an upstream 4xx to 502 and logs the upstream status without charging', async () => {
    const { app, calls } = makeApp(async () => new Response('voice not found', { status: 422 }));

    const response = await app.handle(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('Voice request failed');
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_UPSTREAM_ERROR',
        upstreamStatus: 422,
        status: 502,
        userId: 'tts-upstream-user',
        voiceId: 'voice-1',
      }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('maps an upstream 502 to 503 and logs the upstream status without charging', async () => {
    const { app, calls } = makeApp(async () => new Response('bad gateway', { status: 502 }));

    const response = await app.handle(request());

    expect(response.status).toBe(503);
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_UPSTREAM_ERROR',
        upstreamStatus: 502,
        status: 503,
        voiceId: 'voice-1',
      }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('logs a provider fetch failure and answers 503 without charging', async () => {
    const { app, calls } = makeApp(async () => {
      throw new Error('socket hangup');
    });

    const response = await app.handle(request());

    expect(response.status).toBe(503);
    expect(logged).toContainEqual(
      expect.objectContaining({ msg: 'TTS_UPSTREAM_FETCH_ERROR', voiceId: 'voice-1' }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });
});
