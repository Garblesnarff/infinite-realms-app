/**
 * Quota enforcement when the database is unreachable (#2673).
 *
 * Step 3a recorded the fallback that let calls through while the DB was down. Step 3b removed
 * the per-process memory counter, so these tests now assert that the quota fails closed: the
 * request is refused with 503 and the provider is never called.
 *
 * What is real: AIUsageService (including checkQuotaAndConsume) and the images route.
 * What is injected: the DB client (lib/db.js), which can be made to throw, and the provider
 * fetch. checkQuotaAndConsume itself is never mocked.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { resetCircuitBreakersForTests } from '../../../utils/circuit-breaker.js';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://localhost:5432/test',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'test-image-key',
  OPENROUTER_IMAGE_MODEL: 'google/gemini-3.1-flash-image',
});

// Injection point for the DB client. `down` makes every query and transaction reject.
// When up, `insertAllowed` and `usedUnits` describe what the database says about today's usage.
const db = { down: false, insertAllowed: true, usedUnits: 0 };

const dbDownError = (): Error => new Error('db unavailable (test injection)');

const sqlTag = async (strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
  if (db.down) throw dbDownError();
  const text = strings.join('?');
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE')) return [];
  if (text.includes('pg_advisory_xact_lock')) return [];
  if (text.includes('INSERT INTO ai_usage')) {
    return db.insertAllowed ? [{ total: db.usedUnits + 1 }] : [];
  }
  return [{ total: db.usedUnits, cost_usd: 0 }];
};
const fakeSql = Object.assign(sqlTag, {
  begin: async (work: (tx: typeof sqlTag) => Promise<unknown>): Promise<unknown> => {
    if (db.down) throw dbDownError();
    return work(sqlTag);
  },
});

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/db.js', () => ({ sql: fakeSql }));
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
// Free-plan users. The bearer token is the user id, so each case uses its own user.
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (!token) return { user: null, error: 'Unauthorized' };
    return {
      user: { userId: token, email: `${token}@example.test`, plan: 'free' },
      error: null,
    };
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { imageRoutes } = await import('../images.js');
const { createTtsRoutes } = await import('../tts.js');
const { Elysia } = await import('elysia');
const { llmRoutes } = await import('../llm.js');
const { AIUsageService, QuotaUnavailableError } =
  await import('../../../services/ai-usage-service.js');

type Handler = { handle: (request: Request) => Promise<Response> | Response };

const app = createRequestPipelineApp().use(imageRoutes);
const llmApp = createRequestPipelineApp().use(llmRoutes);

// Voice: a stub auth plugin in place of requireAuth, and a counting stand-in for ElevenLabs.
const voiceAuth = new Elysia({ name: 'quota-db-down-voice-auth' }).derive({ as: 'scoped' }, () => ({
  user: { userId: 'free-user-voice', email: 'voice@example.test', plan: 'free' },
}));
let voiceProviderCalls = 0;
const voiceApp = createRequestPipelineApp().use(
  createTtsRoutes({
    auth: voiceAuth as never,
    fetchImpl: (async () => {
      voiceProviderCalls += 1;
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    }) as never,
  }),
);

const providerImage = {
  choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] } }],
  usage: { prompt_tokens: 4, completion_tokens: 8 },
};

let providerCalls = 0;

beforeEach(() => {
  db.down = false;
  db.insertAllowed = true;
  db.usedUnits = 0;
  providerCalls = 0;
  voiceProviderCalls = 0;
  resetCircuitBreakersForTests();
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify(providerImage), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

function generateRequest(userId: string): Request {
  return new Request('http://localhost/v1/images/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userId}` },
    body: JSON.stringify({ prompt: 'A lantern in the woods' }),
  });
}

describe('quota when the DB is down (#2673 step 3b)', () => {
  it('free image user at the DB daily limit is denied while the DB is up (control)', async () => {
    db.usedUnits = 1; // free image limit is 1 per day
    db.insertAllowed = false;

    const response = await app.handle(generateRequest('free-user-control'));

    expect(response.status).toBe(402);
    expect(providerCalls).toBe(0);
  });

  it('refuses with 503 when the DB is down, and never calls the provider (route)', async () => {
    db.down = true;

    const response = await app.handle(generateRequest('free-user-db-down'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AI quota unavailable' });
    expect(providerCalls).toBe(0);
  });

  it('refuses every image with 503 while the DB is down: no per-process counter lets a second one through', async () => {
    db.down = true;

    const first = await app.handle(generateRequest('free-user-memory-counter'));
    const second = await app.handle(generateRequest('free-user-memory-counter'));

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(providerCalls).toBe(0);
  });

  it('refuses with 503 in every process while the DB is down: a fresh worker gets no fresh counter', async () => {
    db.down = true;
    const userId = 'free-user-new-process';

    // A second module instance stands in for a second worker process.
    // Loaded through a variable: TypeScript cannot resolve a query-string specifier.
    const workerSpecifier = '../../../services/ai-usage-service.js?worker=2';
    const freshWorker = (await import(workerSpecifier)).AIUsageService as typeof AIUsageService;

    const request = { userId, plan: 'free', type: 'image' as const, units: 1 };
    // Compare by message: the fresh worker's error class is from another module instance.
    await expect(AIUsageService.checkQuotaAndConsume(request)).rejects.toThrow(
      'AI quota unavailable',
    );
    await expect(freshWorker.checkQuotaAndConsume(request)).rejects.toThrow('AI quota unavailable');
  });

  it('refuses with 503 on voice while the DB is down, and never calls ElevenLabs (route)', async () => {
    db.down = true;

    const response = await (voiceApp as unknown as Handler).handle(
      new Request('http://localhost/v1/ai-proxy/voice/voice-quota-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer free-user-voice' },
        body: JSON.stringify({ text: 'Hello there.' }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AI quota unavailable' });
    expect(voiceProviderCalls).toBe(0);
  });

  it('reaches the LLM provider once while the DB is up (positive control for the 503 case)', async () => {
    db.insertAllowed = true;

    await (llmApp as unknown as Handler).handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer free-user-llm-control',
        },
        body: JSON.stringify({ prompt: 'Hello there.' }),
      }),
    );

    expect(providerCalls).toBe(1);
  });

  it('refuses with 503 on LLM generate while the DB is down, and never calls the provider (route)', async () => {
    db.down = true;

    const response = await (llmApp as unknown as Handler).handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer free-user-llm-route',
        },
        body: JSON.stringify({ prompt: 'Hello there.' }),
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'AI quota unavailable' });
    expect(providerCalls).toBe(0);
  });

  it('refuses with 503 for LLM calls too while the DB is down', async () => {
    db.down = true;

    await expect(
      AIUsageService.checkQuotaAndConsume({
        userId: 'free-user-llm',
        plan: 'free',
        type: 'llm',
        units: 1,
      }),
    ).rejects.toBeInstanceOf(QuotaUnavailableError);
  });

  it('still answers the quota status read while the DB is down (display only, no enforcement)', async () => {
    db.down = true;

    const status = await AIUsageService.getQuotaStatus({
      userId: 'free-user-status',
      plan: 'free',
      type: 'llm',
    });

    expect(status.usage).toBe(0);
    expect(status.remaining).toBe(15);
  });
});
