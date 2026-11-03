/**
 * POST /v1/llm/generate must fail closed when the plan lookup hits a DB error (#1344).
 *
 * The plan on the request is lenient (authenticateRequest fails open to 'free'),
 * so the generate handler re-resolves strictly before the quota check. A DB blip
 * used to 402 a paying player against the free limit and record the turn's usage
 * under plan='free'. Now it answers 503 and never reaches the quota layer.
 *
 * What is real: the generate route, AIUsageService (including checkQuotaAndConsume),
 * resolveUserPlanStrict, UserPlanCache. What is injected: the DB client (lib/db.js),
 * whose plan query can throw, plus auth, the provider service, the logger and the
 * rate limiter. The quota INSERT assertion is on the SQL the real service issues.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://localhost/test',
  NODE_ENV: 'test',
  OPENROUTER_API_KEY: 'test-key',
  WORKOS_API_KEY: 'test-key',
  WORKOS_CLIENT_ID: 'test-client-id',
});

// 'throw' makes the users-plan query reject; 'pro' returns a pro row.
const plan = { mode: 'pro' as 'throw' | 'pro' };
let generateCalls = 0;
const sqlCalls: Array<{ text: string; values: unknown[] }> = [];

const planQueryError = (): Error => new Error('plan lookup db unavailable (test injection)');

const sqlTag = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
  const text = strings.join('?');
  sqlCalls.push({ text, values });
  if (text.includes('FROM users')) {
    if (plan.mode === 'throw') throw planQueryError();
    return [{ plan: 'pro' }];
  }
  if (text.includes('CREATE TABLE') || text.includes('ALTER TABLE')) return [];
  if (text.includes('pg_advisory_xact_lock')) return [];
  // The quota check's guarded INSERT ... RETURNING reports the row as allowed.
  if (text.includes('RETURNING')) return [{ total: 1 }];
  return [];
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
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'plan-user', email: 'plan@example.test', plan: 'pro' },
    error: null,
  }),
}));
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => {
      generateCalls += 1;
      return { text: 'unreachable', provider: 'openrouter', model: 'test/model' };
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { UserPlanCache } = await import('../../../lib/user-plan-cache.js');

const app = createRequestPipelineApp().use(llmRoutes);

// The body `LlmApiClient.generateText` sends for a DM turn (as in llm-generate-quota-402).
const dmTurnBody = JSON.stringify({
  prompt: 'The party enters the banquet hall. What do they see?',
  player_input: 'I cast Acid Splash at the Bitter End Mercenary',
  maxTokens: 8192,
  temperature: 0.9,
  provider: 'openrouter',
  requestType: 'user',
});

const postGenerate = (): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: dmTurnBody,
    }),
  );

const usageInserts = (): Array<{ text: string; values: unknown[] }> =>
  sqlCalls.filter((call) => call.text.includes('INSERT INTO ai_usage'));

beforeEach(() => {
  plan.mode = 'pro';
  generateCalls = 0;
  sqlCalls.length = 0;
  UserPlanCache.clear();
});

describe('POST /v1/llm/generate plan lookup (#1344)', () => {
  it('answers 503, never a downgrade, when the plan lookup throws — and writes no usage row', async () => {
    plan.mode = 'throw';
    const response = await postGenerate();
    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe('Plan lookup unavailable');
    expect(usageInserts()).toHaveLength(0);
    expect(generateCalls).toBe(0);
  });

  it('reaches the quota layer with the strict plan when the lookup succeeds', async () => {
    plan.mode = 'pro';
    const response = await postGenerate();
    expect(response.status).not.toBe(503);
    const inserts = usageInserts();
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts[0]?.values).toContain('pro');
  });
});
