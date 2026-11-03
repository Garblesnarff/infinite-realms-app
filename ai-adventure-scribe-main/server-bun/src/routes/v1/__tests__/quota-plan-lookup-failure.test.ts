/**
 * GET /v1/llm/quota must fail closed when the plan lookup hits a DB error (#1344).
 *
 * The plan lookup inside authenticateRequest fails open to 'free', so a DB blip
 * used to return 200-with-free and the client showed a paying player the Free
 * gate. The route now re-resolves strictly and answers 503 instead.
 *
 * What is real: authenticateRequest (including resolveUserPlanStrict), the
 * quota route, AIUsageService.getQuotaStatus/getAllQuotaStatuses, UserPlanCache.
 * What is injected: the DB client (lib/db.js), whose plan query can throw, and
 * the logger + rate limiter. The bearer token is a real minted test-auth token.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://localhost/test',
  NODE_ENV: 'test',
  ENABLE_TEST_AUTH: 'true',
  TEST_AUTH_SECRET: 'quota-plan-lookup-test-secret',
  OPENROUTER_API_KEY: 'test-key',
  WORKOS_API_KEY: 'test-key',
  WORKOS_CLIENT_ID: 'test-client-id',
});

// 'throw' makes the users-plan query reject; 'pro' returns a pro row;
// 'none' returns no rows (a user with genuinely no plan row); 'throw-once'
// rejects the first plan query (the lenient lookup inside authenticateRequest)
// and answers 'pro' afterwards, proving mid-request DB recovery.
const plan = { mode: 'pro' as 'throw' | 'pro' | 'none' | 'throw-once' };
let planQueries = 0;

const planQueryError = (): Error => new Error('plan lookup db unavailable (test injection)');

const sqlTag = async (strings: TemplateStringsArray, ..._values: unknown[]): Promise<unknown[]> => {
  const text = strings.join('?');
  if (text.includes('FROM users')) {
    if (plan.mode === 'throw') throw planQueryError();
    if (plan.mode === 'throw-once') {
      planQueries += 1;
      if (planQueries === 1) throw planQueryError();
      return [{ plan: 'pro' }];
    }
    if (plan.mode === 'pro') return [{ plan: 'pro' }];
    return [];
  }
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE')) return [];
  if (text.includes('pg_advisory_xact_lock')) return [];
  return [{ total: 0, cost_usd: 0 }];
};
const fakeSql = Object.assign(sqlTag, {
  begin: async (work: (tx: typeof sqlTag) => Promise<unknown>): Promise<unknown> => {
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
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { mintTestTokens, TEST_AUTH_USER_ID } = await import('../../../lib/test-auth.js');
const { UserPlanCache } = await import('../../../lib/user-plan-cache.js');

const app = createRequestPipelineApp().use(llmRoutes);
const token = mintTestTokens({
  id: TEST_AUTH_USER_ID,
  email: 'quota-plan@example.test',
}).accessToken;

const getQuota = (): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/quota', {
      headers: { authorization: `Bearer ${token}` },
    }),
  );

beforeEach(() => {
  plan.mode = 'pro';
  planQueries = 0;
  UserPlanCache.clear();
});

describe('GET /v1/llm/quota plan lookup (#1344)', () => {
  it('answers 503, never 200-with-free, when the plan lookup throws', async () => {
    plan.mode = 'throw';
    const response = await getQuota();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('Plan lookup unavailable');
    expect(body.plan).toBeUndefined();
  });

  it('answers 200 with the strict plan when the lookup succeeds', async () => {
    plan.mode = 'pro';
    const response = await getQuota();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.plan).toBe('pro');
  });

  it('answers 200 with free when the user genuinely has no plan row', async () => {
    plan.mode = 'none';
    const response = await getQuota();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.plan).toBe('free');
  });

  it('recovers when the DB comes back between the auth lookup and the strict lookup', async () => {
    plan.mode = 'throw-once';
    const response = await getQuota();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.plan).toBe('pro');
  });
});
