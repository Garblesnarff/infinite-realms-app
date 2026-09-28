/**
 * Voice quota units and ElevenLabs dollar rows (#2160).
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import type { TtsRouteOptions } from '../tts.js';

type TtsUsageService = NonNullable<TtsRouteOptions['usageService']>;

const envKeys = ['DATABASE_URL', 'NODE_ENV', 'ELEVENLABS_API_KEY', 'ELEVEN_LABS_API_KEY'];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  NODE_ENV: 'test',
  ELEVENLABS_API_KEY: 'server-test-provider-key',
});

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-workos-client' } }));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: null, error: 'Unauthorized' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({ allowed: true }),
    recordProviderUsage: async () => {},
  },
  elevenLabsCharacterCostUsd: (characters: number) => (characters * 0.05) / 1000,
  voiceQuotaUnits: (characters: number) => Math.ceil(characters / 100),
}));

const { createTtsRoutes } = await import('../tts.js');

const testUsers: Record<string, string> = {
  'Bearer tts-cost-user': 'tts-cost-user',
  'Bearer tts-fail-user': 'tts-fail-user',
};

const testAuth = new Elysia({ name: 'test-tts-usage-auth' }).resolve(
  { as: 'scoped' },
  ({ request }) => {
    const userId = testUsers[request.headers.get('authorization') || ''];
    if (!userId) return status(401, { error: 'Unauthorized' });
    return { user: { userId, email: `${userId}@example.test`, plan: 'pro' } };
  },
);

const quotaConsumes: Array<{ units?: number; type: string; userId: string; plan: string }> = [];
const providerUsage: Array<{
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  type: string;
  model?: string;
  plan: string;
  sessionId?: string | null;
}> = [];
let fetchStatus = 200;
let recordThrows = false;
let forwardedBody = '';

const app = new Elysia().use(
  createTtsRoutes({
    auth: testAuth as unknown as TtsRouteOptions['auth'],
    rateLimit: new Elysia({
      name: 'test-tts-usage-limit',
    }) as unknown as TtsRouteOptions['rateLimit'],
    usageService: {
      checkQuotaAndConsume: async (
        opts: Parameters<TtsUsageService['checkQuotaAndConsume']>[0],
      ) => {
        quotaConsumes.push(opts);
        return { allowed: true, remaining: 1, resetAt: new Date().toISOString() };
      },
      recordProviderUsage: async (opts: Parameters<TtsUsageService['recordProviderUsage']>[0]) => {
        providerUsage.push(opts);
        if (recordThrows) throw new Error('usage insert failed');
      },
    } as unknown as TtsRouteOptions['usageService'],
    fetchImpl: async (_input, init) => {
      forwardedBody = String(init?.body ?? '');
      return new Response(fetchStatus === 200 ? 'audio-bytes' : 'nope', {
        status: fetchStatus,
        headers: { 'content-type': 'audio/mpeg' },
      });
    },
  }),
);

beforeEach(() => {
  fetchStatus = 200;
  recordThrows = false;
  quotaConsumes.length = 0;
  providerUsage.length = 0;
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function speak(token: string, text: string, sessionId?: string): Request {
  return new Request('http://localhost/v1/ai-proxy/voice/voice-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      ...(sessionId ? { sessionId } : {}),
    }),
  });
}

describe('POST /v1/ai-proxy/voice usage', () => {
  it('consumes ceil(chars/100) units and records the character price', async () => {
    const text = 'a'.repeat(101);
    const response = await app.handle(speak('tts-cost-user', text));

    expect(response.status).toBe(200);
    expect(quotaConsumes).toEqual([
      expect.objectContaining({ userId: 'tts-cost-user', plan: 'pro', type: 'voice', units: 2 }),
    ]);
    expect(providerUsage).toEqual([
      expect.objectContaining({
        provider: 'elevenlabs',
        type: 'voice',
        plan: 'pro',
        model: 'eleven_turbo_v2_5',
        inputTokens: 101,
        outputTokens: 0,
        costUsd: (101 * 0.05) / 1000,
      }),
    ]);
    expect(providerUsage[0]?.sessionId).toBeUndefined();
  });

  it('writes session_id when the request includes a session', async () => {
    const response = await app.handle(
      speak('tts-cost-user', 'The lantern flickers.', 'session-2242'),
    );

    expect(response.status).toBe(200);
    expect(providerUsage[0]?.sessionId).toBe('session-2242');
    expect(JSON.parse(forwardedBody)).not.toHaveProperty('sessionId');
  });

  it('returns the voice audio when usage recording throws', async () => {
    recordThrows = true;
    const response = await app.handle(speak('tts-cost-user', 'The lantern flickers.'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('audio/mpeg');
    expect(await response.text()).toBe('audio-bytes');
    expect(providerUsage).toHaveLength(1);
  });

  it('does not record a cost when ElevenLabs rejects the request', async () => {
    fetchStatus = 500;
    const response = await app.handle(speak('tts-fail-user', 'The lantern flickers.'));

    expect(response.status).toBe(503);
    expect(quotaConsumes[0]?.units).toBe(1);
    expect(providerUsage).toEqual([]);
  });
});
