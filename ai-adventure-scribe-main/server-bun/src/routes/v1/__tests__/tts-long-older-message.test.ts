import { describe, it, expect, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import {
  buildVoiceRequestBodies,
  VOICE_REQUEST_TEXT_MAX,
} from '../../../../../shared/voice-request.ts';

import type { TtsRouteOptions } from '../tts.js';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  PORT: '3000',
  CORS_ORIGIN: 'http://localhost:3000',
  WORKOS_API_KEY: 'test-workos-key',
  WORKOS_CLIENT_ID: 'test-workos-client',
  NODE_ENV: 'test',
  ELEVENLABS_API_KEY: 'server-test-provider-key',
});

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-workos-client' } }));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({ allowed: true }),
    assertUsageStoreAvailable: async () => {},
    getQuotaStatus: async () => ({ remaining: 10_000_000 }),
    recordProviderUsage: async () => {},
  },
  elevenLabsCharacterCostUsd: (characters: number) => (characters * 0.05) / 1000,
  voiceQuotaUnits: (characters: number) => Math.ceil(characters / 100),
}));

const { createTtsRoutes } = await import('../tts.js');

const testAuth = new Elysia({ name: 'test-tts-auth-older-message' }).resolve(
  { as: 'scoped' },
  ({ request }) => {
    if (request.headers.get('authorization') !== 'Bearer older-message-user') {
      return status(401, { error: 'Unauthorized' });
    }
    return { user: { userId: 'older-message-user', email: 'older@example.test', plan: 'free' } };
  },
);

const forwarded: string[] = [];
const app = new Elysia().use(
  createTtsRoutes({
    auth: testAuth as unknown as TtsRouteOptions['auth'],
    rateLimit: new Elysia({ name: 'test-tts-no-limit' }) as unknown as TtsRouteOptions['rateLimit'],
    usageService: {
      assertUsageStoreAvailable: async () => {},
      getQuotaStatus: async () => ({ remaining: 10_000_000 }),
      checkQuotaAndConsume: async () => ({ allowed: true, remaining: 1, resetAt: '' }),
      recordProviderUsage: async () => {},
    } as unknown as TtsRouteOptions['usageService'],
    fetchImpl: async (_input, init) => {
      forwarded.push(String(init?.body));
      return new Response('audio-bytes', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    },
  }),
);

// An older DM message: a "Previously, on..." recap longer than the route's text limit (#1348).
const LONG_RECAP = Array.from(
  { length: 240 },
  (_, i) => `Sentence ${i} of the recap tells of the old road and the lantern.`,
).join(' ');

function postVoice(body: string): Promise<Response> {
  return app.handle(
    new Request('http://localhost/v1/ai-proxy/voice/voice-1', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer older-message-user',
      },
      body,
    }),
  );
}

describe('POST /v1/ai-proxy/voice/:voiceId with an older long DM message (#1348)', () => {
  it('rejects one unsplit body longer than the text limit (the cause of Voice unavailable)', async () => {
    expect(LONG_RECAP.length).toBeGreaterThan(VOICE_REQUEST_TEXT_MAX);
    const response = await postVoice(
      JSON.stringify({ text: LONG_RECAP, model_id: 'eleven_flash_v2_5' }),
    );
    expect(response.status).toBe(422);
  });

  it('accepts every request body the client sends for the same recap, and forwards each one', async () => {
    forwarded.length = 0;
    const bodies = buildVoiceRequestBodies(LONG_RECAP, {
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      sessionId: 'session-older',
    });
    expect(bodies.length).toBeGreaterThan(1);

    for (const body of bodies) {
      const response = await postVoice(JSON.stringify(body));
      expect(response.status).toBe(200);
    }

    expect(forwarded).toHaveLength(bodies.length);
    const forwardedText = forwarded
      .map((raw) => (JSON.parse(raw) as { text: string }).text)
      .join('');
    expect(forwardedText).toBe(LONG_RECAP);
  });
});
