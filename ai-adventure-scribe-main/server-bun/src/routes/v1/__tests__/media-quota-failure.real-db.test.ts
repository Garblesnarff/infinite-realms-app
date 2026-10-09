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
const { resetCircuitBreakersForTests } = await importWithRealDb(
  () => import('../../../utils/circuit-breaker.js'),
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
