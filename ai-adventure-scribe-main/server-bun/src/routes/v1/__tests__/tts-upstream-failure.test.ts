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
  'ELEVENLABS_FALLBACK_VOICE_ID',
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
  // The fallback id is set per test below; never leak it into the next one.
  delete process.env.ELEVENLABS_FALLBACK_VOICE_ID;
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

describe('POST /v1/ai-proxy/voice/:voiceId upstream 404 with fallback (#1406)', () => {
  it('retries once with the fallback voice id and returns the clip, charged once', async () => {
    process.env.ELEVENLABS_FALLBACK_VOICE_ID = 'voice-fallback';
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      if (urls.length === 1) return new Response('voice not found', { status: 404 });
      return new Response('audio-bytes', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    const response = await app.handle(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe('audio-bytes');
    expect(urls).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream',
      'https://api.elevenlabs.io/v1/text-to-speech/voice-fallback/stream',
    ]);
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_VOICE_NOT_FOUND',
        upstreamStatus: 404,
        userId: 'tts-upstream-user',
        voiceId: 'voice-1',
      }),
    );
    expect(logged.filter((entry) => entry.msg === 'TTS_VOICE_NOT_FOUND')).toHaveLength(1);
    expect(logged).not.toContainEqual(
      expect.objectContaining({ msg: 'TTS_UPSTREAM_ERROR' }),
    );
    // One usable clip: charged once, not once per attempt.
    expect(calls.consume).toBe(1);
    expect(calls.record).toBe(1);
  });

  it('returns 502 without retrying when no fallback voice is configured', async () => {
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      return new Response('voice not found', { status: 404 });
    });

    const response = await app.handle(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('Voice request failed');
    expect(urls).toEqual(['https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream']);
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_VOICE_NOT_FOUND',
        upstreamStatus: 404,
        voiceId: 'voice-1',
      }),
    );
    expect(logged.filter((entry) => entry.msg === 'TTS_VOICE_NOT_FOUND')).toHaveLength(1);
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_UPSTREAM_ERROR',
        upstreamStatus: 404,
        status: 502,
        voiceId: 'voice-1',
      }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('returns 502 and logs both ids when the fallback voice also 404s', async () => {
    process.env.ELEVENLABS_FALLBACK_VOICE_ID = 'voice-fallback';
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      return new Response('voice not found', { status: 404 });
    });

    const response = await app.handle(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('Voice request failed');
    expect(urls).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream',
      'https://api.elevenlabs.io/v1/text-to-speech/voice-fallback/stream',
    ]);
    expect(logged).toContainEqual(
      expect.objectContaining({ msg: 'TTS_VOICE_NOT_FOUND', voiceId: 'voice-1' }),
    );
    expect(logged).toContainEqual(
      expect.objectContaining({ msg: 'TTS_VOICE_NOT_FOUND', voiceId: 'voice-fallback' }),
    );
    expect(
      logged.filter(
        (entry) => entry.msg === 'TTS_VOICE_NOT_FOUND' && entry.voiceId === 'voice-1',
      ),
    ).toHaveLength(1);
    expect(
      logged.filter(
        (entry) => entry.msg === 'TTS_VOICE_NOT_FOUND' && entry.voiceId === 'voice-fallback',
      ),
    ).toHaveLength(1);
    // The error log names the id that actually failed last.
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_UPSTREAM_ERROR',
        upstreamStatus: 404,
        status: 502,
        voiceId: 'voice-fallback',
      }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('does not retry when the fallback id is the requested id', async () => {
    process.env.ELEVENLABS_FALLBACK_VOICE_ID = 'voice-1';
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      return new Response('voice not found', { status: 404 });
    });

    const response = await app.handle(request());

    expect(response.status).toBe(502);
    expect(urls).toEqual(['https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream']);
    expect(
      logged.filter((entry) => entry.msg === 'TTS_VOICE_NOT_FOUND'),
    ).toHaveLength(1);
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('does not retry a non-404 failure even when a fallback is configured', async () => {
    process.env.ELEVENLABS_FALLBACK_VOICE_ID = 'voice-fallback';
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      return new Response('unprocessable', { status: 422 });
    });

    const response = await app.handle(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe('Voice request failed');
    expect(urls).toEqual(['https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream']);
    expect(logged).not.toContainEqual(
      expect.objectContaining({ msg: 'TTS_VOICE_NOT_FOUND' }),
    );
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_UPSTREAM_ERROR',
        upstreamStatus: 422,
        status: 502,
        voiceId: 'voice-1',
      }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('answers 503 without charging when the fallback retry itself throws', async () => {
    process.env.ELEVENLABS_FALLBACK_VOICE_ID = 'voice-fallback';
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      if (urls.length === 1) return new Response('voice not found', { status: 404 });
      throw new Error('socket hangup');
    });

    const response = await app.handle(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(body.error).toBe('Voice service unavailable');
    expect(urls).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream',
      'https://api.elevenlabs.io/v1/text-to-speech/voice-fallback/stream',
    ]);
    expect(logged).toContainEqual(
      expect.objectContaining({ msg: 'TTS_VOICE_NOT_FOUND', voiceId: 'voice-1' }),
    );
    // The retry throw is a fetch failure naming the fallback id, not an
    // upstream-status error.
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_UPSTREAM_FETCH_ERROR',
        voiceId: 'voice-fallback',
      }),
    );
    expect(logged).not.toContainEqual(
      expect.objectContaining({ msg: 'TTS_UPSTREAM_ERROR' }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('maps a fallback 500 to 503 and names the fallback id in the error log', async () => {
    process.env.ELEVENLABS_FALLBACK_VOICE_ID = 'voice-fallback';
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      if (urls.length === 1) return new Response('voice not found', { status: 404 });
      return new Response('upstream error', { status: 500 });
    });

    const response = await app.handle(request());
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(body.error).toBe('Voice request failed');
    expect(urls).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream',
      'https://api.elevenlabs.io/v1/text-to-speech/voice-fallback/stream',
    ]);
    expect(
      logged.filter(
        (entry) => entry.msg === 'TTS_VOICE_NOT_FOUND' && entry.voiceId === 'voice-1',
      ),
    ).toHaveLength(1);
    // A retry 500 is an upstream error, not a second voice-not-found: the
    // fallback id is named only in TTS_UPSTREAM_ERROR below.
    expect(
      logged.filter(
        (entry) => entry.msg === 'TTS_VOICE_NOT_FOUND' && entry.voiceId === 'voice-fallback',
      ),
    ).toHaveLength(0);
    // The error log names the id that actually failed last.
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'TTS_UPSTREAM_ERROR',
        upstreamStatus: 500,
        status: 503,
        voiceId: 'voice-fallback',
      }),
    );
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });

  it('does not retry when the fallback id is blank', async () => {
    process.env.ELEVENLABS_FALLBACK_VOICE_ID = '   ';
    const urls: string[] = [];
    const { app, calls } = makeApp(async (input) => {
      urls.push(String(input));
      return new Response('voice not found', { status: 404 });
    });

    const response = await app.handle(request());

    expect(response.status).toBe(502);
    expect(urls).toEqual(['https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream']);
    expect(logged.filter((entry) => entry.msg === 'TTS_VOICE_NOT_FOUND')).toHaveLength(1);
    expect(calls.consume).toBe(0);
    expect(calls.record).toBe(0);
  });
});
