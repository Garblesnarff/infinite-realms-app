import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import { VOICE_CONFIGS } from '../../../../../src/services/voice/voice-constants.ts';
import { VOICE_POOLS } from '../../../../../src/services/voice/voice-pools.ts';

import type { TtsRouteOptions } from '../tts.js';

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

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-workos-client' } }));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization');
    const users: Record<string, string> = {
      'Bearer tts-forward-user': 'tts-forward-user',
      'Bearer tts-limited-user': 'tts-limited-user',
      'Bearer tts-other-user': 'tts-other-user',
    };
    const userId = token ? users[token] : undefined;
    return userId
      ? { user: { userId, email: `${userId}@example.test`, plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));
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

const { createTtsRoutes, ttsRoutes } = await import('../tts.js');

const testUsers: Record<string, string> = {
  'Bearer tts-forward-user': 'tts-forward-user',
  'Bearer tts-limited-user': 'tts-limited-user',
  'Bearer tts-other-user': 'tts-other-user',
};

const testAuth = new Elysia({ name: 'test-tts-auth' }).resolve({ as: 'scoped' }, ({ request }) => {
  const userId = testUsers[request.headers.get('authorization') || ''];
  if (!userId) return status(401, { error: 'Unauthorized' });

  return { user: { userId, email: `${userId}@example.test`, plan: 'free' } };
});

const userRequestCounts = new Map<string, number>();
const testRateLimit = new Elysia({ name: 'test-tts-rate-limit' }).onBeforeHandle(
  { as: 'scoped' },
  ({ request, set }) => {
    const userId = testUsers[request.headers.get('authorization') || ''];
    const count = (userRequestCounts.get(userId || 'anonymous') || 0) + 1;
    userRequestCounts.set(userId || 'anonymous', count);

    if (count > 1) {
      set.status = 429;
      return { error: 'Too many requests from this user' };
    }
  },
);

const app = new Elysia().use(
  createTtsRoutes({
    auth: testAuth as unknown as TtsRouteOptions['auth'],
    rateLimit: testRateLimit as unknown as TtsRouteOptions['rateLimit'],
    usageService: {
      assertUsageStoreAvailable: async () => {},
      getQuotaStatus: async () => ({ remaining: 1000 }),
      checkQuotaAndConsume: async () => ({ allowed: true, remaining: 1, resetAt: '' }),
      recordProviderUsage: async () => {},
    } as unknown as TtsRouteOptions['usageService'],
    fetchImpl: async (input, init) => {
      forwardedRequest = { url: String(input), init };
      return new Response('audio-bytes', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    },
  }),
);
const authApp = new Elysia().use(ttsRoutes);

let forwardedRequest: { url: string; init?: RequestInit } | undefined;

beforeEach(() => {
  forwardedRequest = undefined;
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function request(token?: string): Request {
  return new Request('http://localhost/v1/ai-proxy/voice/voice-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      text: 'The lantern flickers.',
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
}

describe('POST /v1/ai-proxy/voice/:voiceId', () => {
  it('requires authentication before contacting ElevenLabs', async () => {
    const response = await authApp.handle(request());

    expect(response.status).toBe(401);
    expect(forwardedRequest).toBeUndefined();
  });

  it('forwards synthesis parameters with the server-held provider key', async () => {
    const response = await app.handle(request('tts-forward-user'));
    const body = await response.text();
    const headers = new Headers(forwardedRequest?.init?.headers);
    const forwardedBody = JSON.parse(String(forwardedRequest?.init?.body)) as Record<
      string,
      unknown
    >;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('audio/mpeg');
    expect(body).toBe('audio-bytes');
    expect(forwardedRequest?.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream',
    );
    expect(headers.get('xi-api-key')).toBe('server-test-provider-key');
    expect(headers.get('authorization')).toBeNull();
    expect(forwardedBody).toEqual({
      text: 'The lantern flickers.',
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
  });

  it('applies the voice limiter per authenticated user', async () => {
    const limitedResponses: Response[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await app.handle(request('tts-limited-user'));
      limitedResponses.push(response);
      if (response.status === 429) break;
    }
    const otherUser = await app.handle(request('tts-other-user'));

    expect(limitedResponses[0]?.status).toBe(200);
    expect(limitedResponses.at(-1)?.status).toBe(429);
    expect(otherUser.status).toBe(200);
  });

  it('accepts voice_settings from every VOICE_CONFIGS and VOICE_POOLS entry', async () => {
    const payloads = [
      ...Object.entries(VOICE_CONFIGS).map(([name, config]) => ({
        name: `VOICE_CONFIGS.${name}`,
        settings: config.settings,
      })),
      ...Object.entries(VOICE_POOLS).flatMap(([pool, voices]) =>
        voices.map((voice, index) => ({
          name: `VOICE_POOLS.${pool}[${index}] (${voice.name})`,
          settings: voice.settings,
        })),
      ),
    ];

    expect(payloads.length).toBeGreaterThan(0);

    for (const [index, { name, settings }] of payloads.entries()) {
      const token = `tts-contract-${index}`;
      const userId = `tts-contract-${index}`;
      testUsers[`Bearer ${token}`] = userId;

      const response = await app.handle(
        new Request('http://localhost/v1/ai-proxy/voice/voice-1', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: 'The lantern flickers.',
            model_id: 'eleven_flash_v2_5',
            voice_settings: settings,
          }),
        }),
      );

      expect(response.status, `${name} should pass the proxy validator`).toBe(200);
    }
  });
});
