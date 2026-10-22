/**
 * #2676: what a media call does to the daily quota when the provider fails.
 *
 * Step 2a recorded the old behaviour (a failed call used up the allowance). Step 2b checks the
 * quota before the provider call and charges only after a usable result, so the failure cases
 * now assert no charge and a retry that still succeeds. A user at the limit is refused before any
 * provider call. These tests make the real routes call a stubbed provider and read the real
 * `ai_usage` table.
 *
 * Real PostgreSQL through the real routes. Faked: authentication (WorkOS cannot be reached from a
 * test) and the provider `fetch` (no real provider is contacted). The provider API keys are stub
 * values set here, never read from the environment.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

import type { TtsRouteOptions } from '../tts.js';

if (hasRealDb) {
  const target = new URL(realDbUrl);
  if (target.hostname !== '127.0.0.1' || target.port !== '55432') {
    throw new Error(
      `[media-quota-failure] refusing real-DB fixtures against ${target.hostname}:${target.port}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

process.env.NODE_ENV ??= 'test';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.PORT ??= '8894';
// Stub values. Assigned, not defaulted, so a real key in the environment cannot reach a provider.
process.env.OPENROUTER_API_KEY = 'stub-openrouter-key';
process.env.ELEVENLABS_API_KEY = 'stub-elevenlabs-key';
process.env.OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-image';
delete process.env.ELEVEN_LABS_API_KEY;

const USER_PREFIX = 'media-quota-user';
// Only the image route reads lib/auth.js directly. Voice takes an injected auth plugin below.
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    return token.startsWith(USER_PREFIX)
      ? { user: { userId: token, email: 'quota@example.test', plan: planOf(token) }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

/** Token format: `media-quota-user-<plan>-<id>`. */
function planOf(token: string): string {
  return token.startsWith(`${USER_PREFIX}-pro-`) ? 'pro' : 'free';
}

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { imageRoutes } = await importWithRealDb(() => import('../images.js'));
const { createTtsRoutes } = await importWithRealDb(() => import('../tts.js'));
const { llmRoutes } = await importWithRealDb(() => import('../llm.js'));
const { resetCircuitBreakersForTests } = await importWithRealDb(
  () => import('../../../utils/circuit-breaker.js'),
);
const { resetProviderKeyLimitForTests } = await importWithRealDb(
  () => import('../../../services/llm-provider-service.js'),
);

/** Stands in for requireAuth (which verifies a WorkOS JWT) so the voice route sees a user. */
const voiceAuth = new Elysia({ name: 'media-quota-stub-voice-auth' }).derive(
  { as: 'scoped' },
  ({ request }) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    return { user: { userId: token, email: 'quota@example.test', plan: planOf(token) } };
  },
);

const imageApp = hasRealDb
  ? createRequestPipelineApp().use(imageRoutes)
  : (null as unknown as ReturnType<typeof createRequestPipelineApp>);
const voiceApp = hasRealDb
  ? createRequestPipelineApp().use(
      createTtsRoutes({ auth: voiceAuth as unknown as TtsRouteOptions['auth'] }),
    )
  : (null as unknown as ReturnType<typeof createRequestPipelineApp>);
const llmApp = hasRealDb
  ? createRequestPipelineApp().use(llmRoutes)
  : (null as unknown as ReturnType<typeof createRequestPipelineApp>);

type Handler = { handle: (request: Request) => Promise<Response> | Response };

type ProviderMode = 'ok' | 'http502' | 'networkThrow' | 'emptyImage';
let providerMode: ProviderMode = 'ok';
let providerCalls: string[] = [];
const originalFetch = globalThis.fetch;
const createdUserIds: string[] = [];

const IMAGE_OK = {
  choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
  usage: { prompt_tokens: 4, completion_tokens: 8 },
};

// A data URI with no base64 payload: the route extracts an empty image string.
const IMAGE_EMPTY = {
  choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,' } }] } }],
  usage: { prompt_tokens: 4, completion_tokens: 8 },
};

/** Serves the stubbed providers and passes every other URL to the real fetch. */
function stubbedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const isOpenRouter = url.startsWith('https://openrouter.ai/');
  const isElevenLabs = url.startsWith('https://api.elevenlabs.io/');
  if (!isOpenRouter && !isElevenLabs) return originalFetch(input, init);

  providerCalls.push(isOpenRouter ? 'openrouter' : 'elevenlabs');
  // #350 FIX round 2: the LLM chat-completions endpoint gets a real chat
  // shape (JSON envelope text + token usage). Image generation also uses
  // /chat/completions (with modalities:['image','text']); those calls keep
  // IMAGE_OK so the #2676 image tests still see images.
  if (isOpenRouter && url.includes('/chat/completions')) {
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    if (!bodyText.includes('"modalities"')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"text": "smoke ok"}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }
  }
  if (providerMode === 'networkThrow')
    return Promise.reject(new TypeError('stubbed network failure'));
  if (providerMode === 'http502') {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'stubbed upstream failure' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return Promise.resolve(
    isOpenRouter
      ? new Response(JSON.stringify(providerMode === 'emptyImage' ? IMAGE_EMPTY : IMAGE_OK), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        }),
  );
}

function userFor(plan: 'free' | 'pro'): string {
  const id = `${USER_PREFIX}-${plan}-${testId('quota')}`;
  createdUserIds.push(id);
  return id;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function postImage(token: string): Promise<Response> {
  return (imageApp as unknown as Handler).handle(
    new Request('http://localhost/v1/images/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: 'A lantern in the woods' }),
    }),
  );
}

async function postVoice(token: string): Promise<Response> {
  return (voiceApp as unknown as Handler).handle(
    new Request('http://localhost/v1/ai-proxy/voice/voice-quota-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      // 12 characters: one voice unit (ceil(12 / 100)).
      body: JSON.stringify({ text: 'Hello there.' }),
    }),
  );
}

/** Units charged today for a user and type. Provider-usage rows carry units 0. */
async function chargedUnits(userId: string, type: 'image' | 'voice'): Promise<number> {
  const rows = (await realDb().execute(sql`
    SELECT COALESCE(SUM(units), 0)::int AS units
    FROM ai_usage
    WHERE user_id = ${userId} AND type = ${type} AND period_start = ${utcToday()}
  `)) as unknown as Array<{ units: number }>;
  return Number(rows[0]?.units ?? 0);
}

/** Every ai_usage row for a user, charge and provider-usage rows alike. */
async function usageRowCount(userId: string): Promise<number> {
  const rows = (await realDb().execute(sql`
    SELECT COUNT(*)::int AS rows FROM ai_usage WHERE user_id = ${userId}
  `)) as unknown as Array<{ rows: number }>;
  return Number(rows[0]?.rows ?? 0);
}

describeWithDb('fix #2676: media calls and quota today (real routes, real ai_usage)', () => {
  beforeAll(() => {
    globalThis.fetch = stubbedFetch as unknown as typeof fetch;
  });

  beforeEach(() => {
    providerMode = 'ok';
    providerCalls = [];
    resetCircuitBreakersForTests();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    const database = realDb();
    for (const id of createdUserIds) {
      await database.execute(sql`DELETE FROM ai_usage WHERE user_id = ${id}`);
    }
    await closeRealDb();
  });

  test('fix #2676: a failed image call does not charge quota', async () => {
    const user = userFor('free');
    providerMode = 'http502';

    const failed = await postImage(user);
    expect(failed.status).toBe(502);
    expect(providerCalls).toEqual(['openrouter']);
    expect(await chargedUnits(user, 'image')).toBe(0);

    // The allowance survived the failure: the free image limit is 1 a day and is still unused.
    providerMode = 'ok';
    const retry = await postImage(user);
    expect(retry.status).toBe(200);
    expect(await chargedUnits(user, 'image')).toBe(1);
    expect(providerCalls).toHaveLength(2);
  });

  test('fix #2676: a network failure on the image provider does not charge quota', async () => {
    const user = userFor('free');
    providerMode = 'networkThrow';

    const failed = await postImage(user);
    expect(failed.status).toBe(500);
    expect(providerCalls).toEqual(['openrouter']);
    expect(await chargedUnits(user, 'image')).toBe(0);

    providerMode = 'ok';
    expect((await postImage(user)).status).toBe(200);
    expect(await chargedUnits(user, 'image')).toBe(1);
  });

  test('fix #2676: an empty image from the provider is a 502 and writes no usage row', async () => {
    const user = userFor('free');
    providerMode = 'emptyImage';

    const empty = await postImage(user);
    expect(empty.status).toBe(502);
    expect(providerCalls).toEqual(['openrouter']);
    expect(await chargedUnits(user, 'image')).toBe(0);
    expect(await usageRowCount(user)).toBe(0);

    // Nothing was charged, so the allowance is still there for a real image.
    providerMode = 'ok';
    expect((await postImage(user)).status).toBe(200);
    expect(await chargedUnits(user, 'image')).toBe(1);
  });

  test('fix #2676: a successful image call still charges one unit (contrast)', async () => {
    const user = userFor('free');

    const ok = await postImage(user);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ image: 'aGVsbG8=' });
    expect(await chargedUnits(user, 'image')).toBe(1);

    // At the limit the call is refused before any provider call.
    expect((await postImage(user)).status).toBe(402);
    expect(providerCalls).toHaveLength(1);
  });

  test('fix #2676: a free-tier voice call is refused before any provider call', async () => {
    const user = userFor('free');

    const refused = await postVoice(user);
    expect(refused.status).toBe(429);
    expect(providerCalls).toEqual([]);
    expect(await chargedUnits(user, 'voice')).toBe(0);
  });

  test('fix #2676: a failed voice call does not charge quota (pro plan)', async () => {
    const user = userFor('pro');
    providerMode = 'http502';

    const failed = await postVoice(user);
    expect(failed.status).toBe(503);
    expect(providerCalls).toEqual(['elevenlabs']);
    expect(await chargedUnits(user, 'voice')).toBe(0);
  });

  test('fix #2676: a network failure on the voice provider does not charge quota (pro plan)', async () => {
    const user = userFor('pro');
    providerMode = 'networkThrow';

    const failed = await postVoice(user);
    expect(failed.status).toBe(503);
    expect(providerCalls).toEqual(['elevenlabs']);
    expect(await chargedUnits(user, 'voice')).toBe(0);
  });

  test('fix #2676: a successful voice call still charges one unit (contrast, pro plan)', async () => {
    const user = userFor('pro');

    const ok = await postVoice(user);
    expect(ok.status).toBe(200);
    expect(await chargedUnits(user, 'voice')).toBe(1);
  });
});

// Plan caps, moved here from the in-memory unit tests (#2673 step 3b). The memory store that
// enforced them while the DB was down is gone, so the caps are asserted against the real
// `ai_usage` table. Each case name is the name it had in the unit file it moved from.
const { AIUsageService, voiceQuotaUnits } = await importWithRealDb(
  () => import('../../../services/ai-usage-service.js'),
);

describeWithDb(
  'plan caps against the real ai_usage table (moved from #2510, #2474, #2160, #2178)',
  () => {
    const capUserIds: string[] = [];
    const capUser = (label: string): string => {
      const id = testId(`cap-${label}`);
      capUserIds.push(id);
      return id;
    };
    const consume = (userId: string, plan: string, type: 'llm' | 'image' | 'voice', units = 1) =>
      AIUsageService.checkQuotaAndConsume({ userId, plan, type, units });

    afterAll(async () => {
      const database = realDb();
      for (const id of capUserIds) {
        await database.execute(sql`DELETE FROM ai_usage WHERE user_id = ${id}`);
      }
      await closeRealDb();
    });

    // was ai-usage-service.test.ts
    test("refuses a free user's 16th message of the day", async () => {
      const userId = capUser('free-llm');
      for (let i = 0; i < 15; i += 1) {
        expect((await consume(userId, 'free', 'llm')).allowed).toBe(true);
      }
      const sixteenth = await consume(userId, 'free', 'llm');
      expect(sixteenth.allowed).toBe(false);
      expect(sixteenth.remaining).toBe(0);
    });

    test("refuses a pro user's 41st message of the day", async () => {
      const userId = capUser('pro-llm');
      for (let i = 0; i < 40; i += 1) {
        expect((await consume(userId, 'pro', 'llm')).allowed).toBe(true);
      }
      const fortyFirst = await consume(userId, 'pro', 'llm');
      expect(fortyFirst.allowed).toBe(false);
      expect(fortyFirst.remaining).toBe(0);
    });

    test('hits the free image limit on call 2 (1 a day)', async () => {
      const userId = capUser('free-image');

      const first = await consume(userId, 'free', 'image');
      const second = await consume(userId, 'free', 'image');

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);
      expect(second.remaining).toBe(0);
    });

    test("refuses a pro user's 3rd image of the day", async () => {
      const userId = capUser('pro-image');

      expect((await consume(userId, 'pro', 'image')).allowed).toBe(true);
      expect((await consume(userId, 'pro', 'image')).allowed).toBe(true);
      const third = await consume(userId, 'pro', 'image');
      expect(third.allowed).toBe(false);
      expect(third.remaining).toBe(0);
    });

    test('hits the voice limit on call 1 for free (voice stays 0)', async () => {
      const result = await consume(capUser('free-voice'), 'free', 'voice');

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('reports remaining counts for messages, images and voice characters', async () => {
      const userId = capUser('pro-display');
      // Spend through the real producers' unit shapes: 1 per message/image
      // (llm.ts / images.ts), voiceQuotaUnits per voice call (tts.ts).
      await consume(userId, 'pro', 'llm');
      await consume(userId, 'pro', 'llm');
      await consume(userId, 'pro', 'image');
      // 250 characters of premium narration, charged as ceil(250/100) units.
      expect((await consume(userId, 'pro', 'voice', voiceQuotaUnits(250))).allowed).toBe(true);

      const all = await AIUsageService.getAllQuotaStatuses({ userId, plan: 'pro' });

      expect(all.quotas.llm).toEqual({ limit: 40, usage: 2, remaining: 38 });
      expect(all.quotas.image).toEqual({ limit: 2, usage: 1, remaining: 1 });
      // Voice displays in characters: stored units × VOICE_CHARS_PER_UNIT.
      expect(all.quotas.voice).toEqual({ limit: 2_000, usage: 300, remaining: 1_700 });
    });

    // was ai-usage-tester-plan.test.ts
    test('enforces the tester llm cap at 500 a day', async () => {
      const within = await AIUsageService.checkQuotaAndConsume({
        userId: capUser('tester-llm-within'),
        plan: 'tester',
        type: 'llm',
        units: 500,
      });
      const over = await AIUsageService.checkQuotaAndConsume({
        userId: capUser('tester-llm-over'),
        plan: 'tester',
        type: 'llm',
        units: 501,
      });

      expect(within.allowed).toBe(true);
      expect(within.remaining).toBe(0);
      expect(over.allowed).toBe(false);
    });

    // was ai-usage-voice-quota.test.ts
    test('sets pro and enterprise caps in units: pro 2,000 and enterprise 200,000 characters/day', async () => {
      const cases = [
        { plan: 'pro', limit: 20 },
        { plan: 'enterprise', limit: 2000 },
      ];

      for (const { plan, limit } of cases) {
        const within = await AIUsageService.checkQuotaAndConsume({
          userId: capUser(`${plan}-within`),
          plan,
          type: 'voice',
          units: limit,
        });
        const over = await AIUsageService.checkQuotaAndConsume({
          userId: capUser(`${plan}-over`),
          plan,
          type: 'voice',
          units: limit + 1,
        });

        expect(within.allowed).toBe(true);
        expect(within.remaining).toBe(0);
        expect(over.allowed).toBe(false);
      }
    });

    // #128 sets the tester voice cap too (200 units = 20,000 characters); the
    // pro/enterprise cases above never pinned it.
    test('sets the tester voice cap in units: 200 units = 20,000 characters/day (#128)', async () => {
      const within = await AIUsageService.checkQuotaAndConsume({
        userId: capUser('tester-voice-within'),
        plan: 'tester',
        type: 'voice',
        units: 200,
      });
      const over = await AIUsageService.checkQuotaAndConsume({
        userId: capUser('tester-voice-over'),
        plan: 'tester',
        type: 'voice',
        units: 201,
      });

      expect(within.allowed).toBe(true);
      expect(within.remaining).toBe(0);
      expect(over.allowed).toBe(false);

      const status = await AIUsageService.getQuotaStatus({
        userId: capUser('tester-voice-status'),
        plan: 'tester',
        type: 'voice',
      });
      expect(status.limits.daily.voice).toBe(200);
      expect(status.remainingCharacters).toBe(20_000);
    });

    // #127: the caps above are pinned within a day, but the reset itself was
    // never pinned. Usage is SUM(units) over rows with period_start = the UTC
    // date, so a new UTC day must restore the whole allowance without any row
    // being deleted or rewritten.
    test('resets the voice allowance on the UTC day boundary: yesterday\u2019s full cap does not count today (#127)', async () => {
      const database = realDb();
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const insertUsage = async (userId: string, periodStart: string): Promise<void> => {
        await database.execute(sql`
          INSERT INTO ai_usage (org_id, user_id, plan, type, units, period_start)
          VALUES (NULL, ${userId}, 'pro', 'voice', 20, ${periodStart})
        `);
      };

      // Yesterday this user spent the entire pro voice day (20 units), in the
      // row shape checkQuotaAndConsume writes.
      const resetUser = capUser('pro-voice-reset');
      await insertUsage(resetUser, yesterday);

      // Today the allowance is whole again, and resetAt is the next UTC midnight.
      const status = await AIUsageService.getQuotaStatus({
        userId: resetUser,
        plan: 'pro',
        type: 'voice',
      });
      expect(status.usage).toBe(0);
      expect(status.remaining).toBe(20);
      expect(status.remainingCharacters).toBe(2_000);
      expect(status.resetAt.endsWith('T00:00:00.000Z')).toBe(true);
      expect(Date.parse(status.resetAt)).toBeGreaterThan(Date.now());

      const first = await consume(resetUser, 'pro', 'voice', voiceQuotaUnits(100));
      expect(first.allowed).toBe(true);
      expect(first.remaining).toBe(19);

      // The reset is the period filter, not a deletion: yesterday's row is
      // still there, next to the row the consume above just wrote.
      expect(await usageRowCount(resetUser)).toBe(2);

      // Contrast, same cap under TODAY's period: the allowance really is spent.
      const spentUser = capUser('pro-voice-spent-today');
      await insertUsage(spentUser, utcToday());
      const refused = await consume(spentUser, 'pro', 'voice', voiceQuotaUnits(100));
      expect(refused.allowed).toBe(false);
      expect(refused.remaining).toBe(0);
    });

    test('lets a pro user at 1,900 characters send a 100-character line, then refuses at 2,000', async () => {
      const userId = capUser('pro-chars-boundary');
      const spend = (characters: number) =>
        consume(userId, 'pro', 'voice', voiceQuotaUnits(characters));

      // 19 lines of 100 characters = 1,900 characters used.
      for (let i = 0; i < 19; i++) expect((await spend(100)).allowed).toBe(true);

      const last = await spend(100);
      expect(last.allowed).toBe(true);
      expect(last.remaining).toBe(0);

      const refused = await spend(100);
      expect(refused.allowed).toBe(false);
    });

    test('reports remaining voice in characters', async () => {
      const userId = capUser('pro-chars-display');
      await consume(userId, 'pro', 'voice', voiceQuotaUnits(1_950));
      // 1,950 characters in one call costs ceil(19.5) = 20 units: the whole day.
      const spent = await AIUsageService.getQuotaStatus({ userId, plan: 'pro', type: 'voice' });
      expect(spent.remainingCharacters).toBe(0);

      const fresh = await AIUsageService.getQuotaStatus({
        userId: capUser('pro-chars-display-fresh'),
        plan: 'pro',
        type: 'voice',
      });
      expect(fresh.remainingCharacters).toBe(2_000);

      const partial = capUser('pro-chars-display-partial');
      await consume(partial, 'pro', 'voice', voiceQuotaUnits(500));
      const status = await AIUsageService.getQuotaStatus({
        userId: partial,
        plan: 'pro',
        type: 'voice',
      });
      expect(status.remainingCharacters).toBe(1_500);
      expect(status.usage).toBe(5);
      expect(status.remaining).toBe(15);
      expect(status.limits.daily.voice).toBe(20);

      const image = await AIUsageService.getQuotaStatus({
        userId: partial,
        plan: 'pro',
        type: 'image',
      });
      expect(image.remainingCharacters).toBeUndefined();
    });

    test('keeps free voice at 0 after the rebase onto #2178', async () => {
      const userId = capUser('free-voice-zero');
      const denied = await consume(userId, 'free', 'voice', 1);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);

      const status = await AIUsageService.getQuotaStatus({
        userId: capUser('free-voice-zero-status'),
        plan: 'free',
        type: 'voice',
      });
      expect(status.limits.daily.voice).toBe(0);
    });
  },
);

/** #350 FIX round 2: a successful turn carries its ai_usage row ids back, and
 * DELETE /v1/llm/usage removes exactly those rows (the deploy smoke's cleanup).
 * Real routes, real ai_usage table; the provider fetch is stubbed. */
async function postGenerate(token: string): Promise<Response> {
  return (llmApp as unknown as Handler).handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        prompt: 'Reply with exactly these three words: smoke test ok',
        player_input: 'smoke test',
        maxTokens: 64,
        temperature: 0,
        provider: 'openrouter',
        requestType: 'user',
      }),
    }),
  );
}

async function deleteUsage(token: string, ids: unknown, secret?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
  if (secret !== undefined) headers['x-smoke-cleanup-secret'] = secret;
  return (llmApp as unknown as Handler).handle(
    new Request('http://localhost/v1/llm/usage', {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ ids }),
    }),
  );
}

// The deploy smoke's cleanup secret; the route requires it because deleting
// usage rows restores quota (quota = limit - SUM(units)).
const CLEANUP_SECRET = 'test-cleanup-secret-not-real';

describeWithDb('fix #350 round 2: usageIds and the usage-row cleanup (real routes, real ai_usage)', () => {
  const OLD_SECRET = process.env.SMOKE_CLEANUP_SECRET;
  beforeAll(() => {
    globalThis.fetch = stubbedFetch as unknown as typeof fetch;
    process.env.SMOKE_CLEANUP_SECRET = CLEANUP_SECRET;
  });

  beforeEach(() => {
    providerCalls = [];
    resetCircuitBreakersForTests();
    resetProviderKeyLimitForTests();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (OLD_SECRET === undefined) delete process.env.SMOKE_CLEANUP_SECRET;
    else process.env.SMOKE_CLEANUP_SECRET = OLD_SECRET;
    const database = realDb();
    for (const id of createdUserIds) {
      await database.execute(sql`DELETE FROM ai_usage WHERE user_id = ${id}`);
    }
  });

  test('a successful turn returns usageIds; deleting them leaves no rows', async () => {
    const user = userFor('free');

    const res = await postGenerate(user);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.parsed).toBe(true);
    expect(body.degraded ?? false).toBe(false);
    const ids = body.usageIds as number[];
    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toHaveLength(2);
    // One quota row (units 1) and one provider-usage row (units 0).
    expect(await usageRowCount(user)).toBe(2);

    const del = await deleteUsage(user, ids, CLEANUP_SECRET);
    expect(del.status).toBe(200);
    expect(((await del.json()) as Record<string, unknown>).deleted).toBe(2);
    expect(await usageRowCount(user)).toBe(0);
  });

  test('deleting usage rows without the cleanup secret is refused (403)', async () => {
    const user = userFor('free');

    const res = await postGenerate(user);
    const ids = ((await res.json()) as Record<string, unknown>).usageIds as number[];
    expect(ids).toHaveLength(2);

    // No secret header: refused, rows untouched — otherwise this endpoint
    // would be a self-service quota reset (quota = limit - SUM(units)).
    const del = await deleteUsage(user, ids);
    expect(del.status).toBe(403);
    expect(await usageRowCount(user)).toBe(2);

    // Wrong secret: likewise refused.
    const delWrong = await deleteUsage(user, ids, 'wrong-secret');
    expect(delWrong.status).toBe(403);
    expect(await usageRowCount(user)).toBe(2);

    // With the secret the smoke's cleanup works.
    const delOk = await deleteUsage(user, ids, CLEANUP_SECRET);
    expect(((await delOk.json()) as Record<string, unknown>).deleted).toBe(2);
    expect(await usageRowCount(user)).toBe(0);
  });

  test("a caller cannot delete another user's usage rows", async () => {
    const a = userFor('free');
    const b = userFor('free');

    const res = await postGenerate(a);
    const ids = ((await res.json()) as Record<string, unknown>).usageIds as number[];
    expect(ids).toHaveLength(2);

    const del = await deleteUsage(b, ids, CLEANUP_SECRET);
    expect(del.status).toBe(200);
    expect(((await del.json()) as Record<string, unknown>).deleted).toBe(0);
    expect(await usageRowCount(a)).toBe(2);

    // Cleanup of a's rows still works for a.
    const delA = await deleteUsage(a, ids, CLEANUP_SECRET);
    expect(((await delA.json()) as Record<string, unknown>).deleted).toBe(2);
    expect(await usageRowCount(a)).toBe(0);
  });
});
