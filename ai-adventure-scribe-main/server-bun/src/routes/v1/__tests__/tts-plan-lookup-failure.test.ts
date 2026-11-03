/**
 * POST /v1/ai-proxy/voice/:voiceId must fail closed when the plan lookup hits a DB
 * error (#1344).
 *
 * The plan on the request is lenient (authenticateRequest fails open to 'free'),
 * so the voice handler resolves strictly once, before any quota check or charge.
 * A DB blip used to 429/402 a paying player against the free limit. Now it answers
 * 503 and never calls ElevenLabs.
 *
 * What is real: the voice route, resolveUserPlanStrict. What is injected: the DB
 * client (lib/db.js), whose plan query can throw, plus the quota service, the
 * logger and the provider fetch. Auth is a stub plugin returning a pro user.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import type { TtsRouteOptions } from '../tts.js';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://localhost/test',
  NODE_ENV: 'test',
  ELEVENLABS_API_KEY: 'test-key',
  // services/workos.ts constructs its client at import from process.env;
  // the route never verifies a token here (auth is injected), so a dummy key.
  WORKOS_API_KEY: 'test-key',
});

// 'throw' makes the users-plan query reject; 'pro' returns a pro row.
const plan = { mode: 'pro' as 'throw' | 'pro' };
let providerCalls = 0;
const quotaStatusCalls: Array<Record<string, unknown>> = [];

const planQueryError = (): Error => new Error('plan lookup db unavailable (test injection)');

const sqlTag = async (strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
  const text = strings.join('?');
  if (text.includes('FROM users')) {
    if (plan.mode === 'throw') throw planQueryError();
    return [{ plan: 'pro' }];
  }
  return [];
};
mock.module('../../../lib/db.js', () => ({ sql: sqlTag }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-workos-client' } }));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    assertUsageStoreAvailable: async () => {},
    getQuotaStatus: async (opts: Record<string, unknown>) => {
      quotaStatusCalls.push(opts);
      return { remaining: 1000 };
    },
    checkQuotaAndConsume: async () => ({ allowed: true, remaining: 1 }),
    recordProviderUsage: async () => {},
  },
  elevenLabsCharacterCostUsd: (characters: number) => (characters * 0.05) / 1000,
  voiceQuotaUnits: (characters: number) => Math.ceil(characters / 100),
}));

const { createTtsRoutes } = await import('../tts.js');
const { UserPlanCache } = await import('../../../lib/user-plan-cache.js');

const testAuth = new Elysia({ name: 'test-tts-plan-auth' }).resolve(
  { as: 'scoped' },
  ({ request }) => {
    if (request.headers.get('authorization') !== 'Bearer <redacted>') {
      return status(401, { error: 'Unauthorized' });
    }
    return { user: { userId: 'tts-plan-user', email: 'tts-plan@example.test', plan: 'pro' } };
  },
);

const app = new Elysia().use(
  createTtsRoutes({
    auth: testAuth as unknown as TtsRouteOptions['auth'],
    rateLimit: new Elysia({
      name: 'test-tts-plan-limit',
    }) as unknown as TtsRouteOptions['rateLimit'],
    fetchImpl: (async () => {
      providerCalls += 1;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    }) as never,
  }),
);

const postVoice = (): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/ai-proxy/voice/voice-plan-test', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello there.' }),
    }),
  );

beforeEach(() => {
  plan.mode = 'pro';
  providerCalls = 0;
  quotaStatusCalls.length = 0;
  UserPlanCache.clear();
});

describe('POST /v1/ai-proxy/voice/:voiceId plan lookup (#1344)', () => {
  it('answers 503, never a downgrade, when the plan lookup throws — and never calls ElevenLabs', async () => {
    plan.mode = 'throw';
    const response = await postVoice();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('Plan lookup unavailable');
    expect(providerCalls).toBe(0);
    expect(quotaStatusCalls).toHaveLength(0);
  });

  it('checks quota with the strict plan when the lookup succeeds', async () => {
    plan.mode = 'pro';
    const response = await postVoice();
    expect(response.status).toBe(200);
    expect(quotaStatusCalls[0]?.plan).toBe('pro');
    expect(providerCalls).toBe(1);
  });
});
