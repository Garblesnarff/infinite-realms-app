/**
 * Reserve-before-provider for voice quota (#1789).
 *
 * Two parallel TTS requests could both pass the getQuotaStatus read, both
 * reach ElevenLabs, and both incur provider cost. The route now reserves the
 * charge (checkQuotaAndConsume) before the provider call and releases it
 * (refundQuota) when the provider call fails, so the loser is refused before
 * any provider call and a failed call charges nothing.
 *
 * What is real: the voice route, voiceQuotaUnits, the wire request bodies.
 * What is injected: the provider fetch, the plan lookup, and the usage
 * service — whose stub mirrors the real service's atomic guard: the guarded
 * INSERT...SELECT under the advisory lock takes the units or refuses in one
 * step. This stub does the check-and-set synchronously (no await inside), so
 * two concurrent route handlers cannot both take the last unit — exactly the
 * property the DB guard provides in production. The DB-level atomicity itself
 * is covered by the service's own tests.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

import type { TtsRouteOptions } from '../tts.js';

type TtsUsageService = NonNullable<TtsRouteOptions['usageService']>;

const envKeys = [
  'DATABASE_URL',
  'NODE_ENV',
  'ELEVENLABS_API_KEY',
  'ELEVEN_LABS_API_KEY',
  'ELEVENLABS_MODEL',
];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  NODE_ENV: 'test',
  ELEVENLABS_API_KEY: 'server-test-provider-key',
});
delete process.env.ELEVENLABS_MODEL;

const logged: Array<Record<string, unknown>> = [];
mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-workos-client' } }));
mock.module('../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: (obj: unknown) => {
      logged.push(obj as Record<string, unknown>);
    },
    error: (obj: unknown) => {
      logged.push(obj as Record<string, unknown>);
    },
  },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: null, error: 'Unauthorized' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({ allowed: true }),
    assertUsageStoreAvailable: async () => {},
    getQuotaStatus: async () => ({ remaining: 1000 }),
    recordProviderUsage: async () => {},
    refundQuota: async () => {},
  },
  elevenLabsCharacterCostUsd: (characters: number) => (characters * 0.05) / 1000,
  voiceQuotaUnits: (characters: number) => Math.ceil(characters / 100),
}));

// #1344: the handlers re-resolve the plan strictly; the auth stub's
// plan is what the strict lookup must return here.
mock.module('../../../lib/user-plan.js', () => ({
  resolveUserPlanStrict: async () => 'pro',
}));
const { createTtsRoutes } = await import('../tts.js');

const testUsers: Record<string, string> = {
  'Bearer tts-reserve-user': 'tts-reserve-user',
};

const testAuth = new Elysia({ name: 'test-tts-reserve-auth' }).resolve(
  { as: 'scoped' },
  ({ request }) => {
    const userId = testUsers[request.headers.get('authorization') || ''];
    if (!userId) return status(401, { error: 'Unauthorized' });
    return { user: { userId, email: `${userId}@example.test`, plan: 'pro' } };
  },
);

// The fake usage store. `limit` is the voice allowance in units; `used` is
// what reservations have taken. checkQuotaAndConsume's body has no await, so
// its check-and-set runs atomically within one event-loop turn — the stub
// equivalent of the real service's advisory lock + guarded insert.
let voiceLimit = 1;
let voiceUsed = 0;
let refundThrows = false;
const quotaConsumes: Array<{ units?: number; type: string; userId: string; plan: string }> = [];
const consumeOutcomes: boolean[] = [];
const quotaRefunds: Array<{ units?: number; type: string; userId: string; plan: string }> = [];
let providerRecords = 0;
let providerCalls = 0;
let fetchStatus = 200;
let fetchDelayMs = 0;
let fetchThrows = false;

const app = new Elysia().use(
  createTtsRoutes({
    auth: testAuth as unknown as TtsRouteOptions['auth'],
    rateLimit: new Elysia({
      name: 'test-tts-reserve-limit',
    }) as unknown as TtsRouteOptions['rateLimit'],
    usageService: {
      assertUsageStoreAvailable: async () => {},
      getQuotaStatus: async () => ({ remaining: Math.max(0, voiceLimit - voiceUsed) }),
      checkQuotaAndConsume: async (
        opts: Parameters<TtsUsageService['checkQuotaAndConsume']>[0],
      ) => {
        const units = Math.max(1, Math.floor(opts.units ?? 1));
        quotaConsumes.push(opts);
        if (voiceUsed + units > voiceLimit) {
          consumeOutcomes.push(false);
          return {
            allowed: false,
            remaining: Math.max(0, voiceLimit - voiceUsed),
            resetAt: new Date().toISOString(),
            usageId: null,
          };
        }
        voiceUsed += units;
        consumeOutcomes.push(true);
        return {
          allowed: true,
          remaining: Math.max(0, voiceLimit - voiceUsed),
          resetAt: new Date().toISOString(),
          usageId: voiceUsed,
        };
      },
      refundQuota: async (opts: Parameters<TtsUsageService['refundQuota']>[0]) => {
        const units = Math.max(1, Math.floor(opts.units ?? 1));
        quotaRefunds.push(opts);
        if (refundThrows) throw new Error('refund store unavailable');
        voiceUsed = Math.max(0, voiceUsed - units);
      },
      recordProviderUsage: async () => {
        providerRecords += 1;
      },
    } as unknown as TtsRouteOptions['usageService'],
    fetchImpl: async () => {
      providerCalls += 1;
      if (fetchThrows) throw new Error('provider unreachable');
      if (fetchDelayMs > 0) await new Promise((r) => setTimeout(r, fetchDelayMs));
      return new Response(fetchStatus === 200 ? 'audio-bytes' : 'nope', {
        status: fetchStatus,
        headers: { 'content-type': 'audio/mpeg' },
      });
    },
  }),
);

beforeEach(() => {
  voiceLimit = 1;
  voiceUsed = 0;
  refundThrows = false;
  fetchStatus = 200;
  fetchDelayMs = 0;
  fetchThrows = false;
  quotaConsumes.length = 0;
  consumeOutcomes.length = 0;
  quotaRefunds.length = 0;
  providerRecords = 0;
  providerCalls = 0;
  logged.length = 0;
});

afterAll(() => {
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function speak(text: string): Request {
  return new Request('http://localhost/v1/ai-proxy/voice/voice-1', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer tts-reserve-user',
    },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
  });
}

describe('POST /v1/ai-proxy/voice/:voiceId reserve before provider (#1789)', () => {
  it('two parallel requests result in one charge and one refusal, provider called once', async () => {
    // One unit of allowance: the first reservation takes it, the second loses.
    voiceLimit = 1;
    fetchDelayMs = 50;
    const text = 'The lantern flickers.'; // 22 chars -> 1 unit

    const [first, second] = await Promise.all([app.handle(speak(text)), app.handle(speak(text))]);

    // One winner, one refusal — order between the two is not pinned.
    expect([first.status, second.status].sort()).toEqual([200, 429]);
    // The loser never reached the provider: one upstream call total, while the
    // winner was still in flight.
    expect(providerCalls).toBe(1);
    // Both passed the pre-check read; the reserve decided. One allowed, one refused.
    expect(quotaConsumes).toHaveLength(2);
    expect(quotaConsumes.filter((c) => c.units === 1)).toHaveLength(2);
    // Asserted directly, not implied: exactly one reserve was allowed.
    expect([...consumeOutcomes].sort()).toEqual([false, true]);
    // The winner's reservation stands; nothing was refunded.
    expect(quotaRefunds).toEqual([]);
    expect(providerRecords).toBe(1);
    expect(voiceUsed).toBe(1);
  });

  it('a failed provider call releases the reservation, so the next request succeeds', async () => {
    fetchStatus = 500;
    const failed = await app.handle(speak('The lantern flickers.'));

    expect(failed.status).toBe(503);
    expect(quotaConsumes).toEqual([
      expect.objectContaining({ userId: 'tts-reserve-user', plan: 'pro', type: 'voice', units: 1 }),
    ]);
    // The reservation went back: same user, plan, type and units.
    expect(quotaRefunds).toEqual([
      expect.objectContaining({ userId: 'tts-reserve-user', plan: 'pro', type: 'voice', units: 1 }),
    ]);
    expect(providerRecords).toBe(0);
    expect(voiceUsed).toBe(0);

    // The allowance is whole again: the same request now succeeds.
    fetchStatus = 200;
    const retried = await app.handle(speak('The lantern flickers.'));
    expect(retried.status).toBe(200);
    expect(quotaConsumes).toHaveLength(2);
    expect(quotaRefunds).toHaveLength(1);
    expect(providerRecords).toBe(1);
    expect(voiceUsed).toBe(1);
  });

  it('a provider fetch failure releases the reservation, so the next request succeeds', async () => {
    fetchThrows = true;
    const failed = await app.handle(speak('The lantern flickers.'));

    expect(failed.status).toBe(503);
    expect(quotaConsumes).toHaveLength(1);
    expect(quotaRefunds).toEqual([
      expect.objectContaining({ userId: 'tts-reserve-user', plan: 'pro', type: 'voice', units: 1 }),
    ]);
    expect(providerRecords).toBe(0);
    expect(voiceUsed).toBe(0);

    fetchThrows = false;
    const retried = await app.handle(speak('The lantern flickers.'));
    expect(retried.status).toBe(200);
    expect(quotaConsumes).toHaveLength(2);
    expect(quotaRefunds).toHaveLength(1);
    expect(providerRecords).toBe(1);
    expect(voiceUsed).toBe(1);
  });

  it('a refund failure is logged and never changes the response', async () => {
    refundThrows = true;
    fetchStatus = 500;
    const response = await app.handle(speak('The lantern flickers.'));

    // The provider failure is a 503 either way; the failed refund is logged.
    expect(response.status).toBe(503);
    expect(quotaConsumes).toHaveLength(1);
    expect(quotaRefunds).toHaveLength(1);
    // The refund never landed, so the unit stays consumed — a real 1-unit leak
    // on a DB blip, visible in the TTS_VOICE_REFUND_FAILED log, not silently zeroed.
    expect(voiceUsed).toBe(1);
    expect(logged).toContainEqual(
      expect.objectContaining({ msg: 'TTS_VOICE_REFUND_FAILED', userId: 'tts-reserve-user' }),
    );
  });
});
