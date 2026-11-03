/**
 * POST /v1/images/generate must fail closed when the plan lookup hits a DB error (#1344).
 *
 * The plan on the request is lenient (authenticateRequest fails open to 'free'),
 * so the generate handler re-resolves strictly before the quota check. A DB blip
 * used to 402 a paying player against the free limit. Now it answers 503 and never
 * calls the provider.
 *
 * What is real: the images route, resolveUserPlanStrict. What is injected: the DB
 * client (lib/db.js), whose plan query can throw, plus auth, the quota service,
 * the logger, the rate limiter and the provider fetch.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://localhost/test',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'test-key',
  OPENROUTER_IMAGE_MODEL: 'google/gemini-3.1-flash-image',
});

// 'throw' makes the users-plan query reject; 'pro' returns a pro row.
const plan = { mode: 'pro' as 'throw' | 'pro' };
let providerCalls = 0;
const quotaStatusCalls: Array<Record<string, unknown>> = [];
const consumeCalls: Array<Record<string, unknown>> = [];

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
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') !== 'Bearer <redacted>') {
      return { user: null, error: 'Unauthorized' };
    }
    return {
      user: { userId: 'image-plan-user', email: 'image-plan@example.test', plan: 'pro' },
      error: null,
    };
  },
}));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    assertUsageStoreAvailable: async () => {},
    getQuotaStatus: async (opts: Record<string, unknown>) => {
      quotaStatusCalls.push(opts);
      return { plan: 'pro', usage: 0, remaining: 10 };
    },
    checkQuotaAndConsume: async (opts: Record<string, unknown>) => {
      consumeCalls.push(opts);
      return { allowed: true, remaining: 9 };
    },
    recordProviderUsage: async () => {},
  },
}));

const { imageRoutes } = await import('../images.js');
const { UserPlanCache } = await import('../../../lib/user-plan-cache.js');

const app = new Elysia().use(imageRoutes);

const providerImage = {
  choices: [
    {
      message: {
        images: [{ image_url: { url: 'data:image/png;base64,aGVsbG8=' } }],
      },
    },
  ],
  usage: { prompt_tokens: 4, completion_tokens: 8 },
};
const postGenerate = (): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/images/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'A lantern in the woods' }),
    }),
  );

beforeEach(() => {
  plan.mode = 'pro';
  providerCalls = 0;
  quotaStatusCalls.length = 0;
  consumeCalls.length = 0;
  UserPlanCache.clear();
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify(providerImage), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

describe('POST /v1/images/generate plan lookup (#1344)', () => {
  it('answers 503, never a downgrade, when the plan lookup throws — and never calls the provider', async () => {
    plan.mode = 'throw';
    const response = await postGenerate();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('Plan lookup unavailable');
    expect(providerCalls).toBe(0);
    expect(quotaStatusCalls).toHaveLength(0);
    expect(consumeCalls).toHaveLength(0);
  });

  it('checks quota with the strict plan when the lookup succeeds', async () => {
    plan.mode = 'pro';
    const response = await postGenerate();
    expect(response.status).toBe(200);
    expect(quotaStatusCalls[0]?.plan).toBe('pro');
    expect(consumeCalls[0]?.plan).toBe('pro');
    expect(providerCalls).toBe(1);
  });
});
