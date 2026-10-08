/**
 * Characterization of quota enforcement when the database is unreachable (#2673 step 3a).
 *
 * Documents current behavior, including the weakness the issue describes: when the DB
 * call inside checkQuotaAndConsume throws, the service falls back to a per-process memory
 * counter. These tests do not assert that the behavior is right; step 3b removes the
 * fallback and will flip the assertions.
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
const { AIUsageService } = await import('../../../services/ai-usage-service.js');

const app = createRequestPipelineApp().use(imageRoutes);

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

describe('quota when the DB is down (#2673 step 3a characterization)', () => {
  it('documents #2673: free image user at the DB daily limit is denied while the DB is up (control)', async () => {
    db.usedUnits = 1; // free image limit is 1 per day
    db.insertAllowed = false;

    const response = await app.handle(generateRequest('free-user-control'));

    expect(response.status).toBe(402);
    expect(providerCalls).toBe(0);
  });

  it('documents #2673: quota lets calls through when the DB is down today', async () => {
    db.down = true;

    const response = await app.handle(generateRequest('free-user-db-down'));

    expect(response.status).toBe(200);
    expect(providerCalls).toBe(1);
  });

  it('documents #2673: a second image while the DB is down is denied by the per-process memory counter', async () => {
    db.down = true;

    const first = await app.handle(generateRequest('free-user-memory-counter'));
    const second = await app.handle(generateRequest('free-user-memory-counter'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(402);
    expect(providerCalls).toBe(1);
  });

  it('documents #2673: the memory counter starts at zero in a new process, so the limit resets', async () => {
    db.down = true;
    const userId = 'free-user-new-process';

    // A second module instance stands in for a second worker process: its static
    // memTotals map starts empty.
    // Loaded through a variable: TypeScript cannot resolve a query-string specifier.
    const workerSpecifier = '../../../services/ai-usage-service.js?worker=2';
    const freshWorker = (await import(workerSpecifier)).AIUsageService as typeof AIUsageService;

    const request = { userId, plan: 'free', type: 'image' as const, units: 1 };
    const firstWorker = await AIUsageService.checkQuotaAndConsume(request);
    const firstWorkerAgain = await AIUsageService.checkQuotaAndConsume(request);
    const secondWorker = await freshWorker.checkQuotaAndConsume(request);

    expect(firstWorker.allowed).toBe(true);
    expect(firstWorkerAgain.allowed).toBe(false);
    expect(secondWorker.allowed).toBe(true);
  });

  it('documents #2673: free LLM quota with the DB down allows 15 calls per process, then denies', async () => {
    db.down = true;
    const userId = 'free-user-llm-ceiling';
    const outcomes: boolean[] = [];

    for (let call = 0; call < 16; call += 1) {
      const result = await AIUsageService.checkQuotaAndConsume({
        userId,
        plan: 'free',
        type: 'llm',
        units: 1,
      });
      outcomes.push(result.allowed);
    }

    expect(outcomes.filter(Boolean)).toHaveLength(15);
    expect(outcomes[15]).toBe(false);
  });
});
