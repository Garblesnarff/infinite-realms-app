/**
 * #350: a provider key/credit limit that exhausts the whole chain.
 *
 * Through the real route (createRequestPipelineApp + llmRoutes) AND the real
 * LLMProviderService. Only the upstream HTTP call (globalThis.fetch) is
 * stubbed: every model in the chain answers 403 "Key limit exceeded". No live
 * DM or provider call is made.
 *
 * Asserts the two things the operator and the player depend on:
 *   - exactly one LLM_PROVIDER_KEY_LIMIT log line for the turn, carrying the
 *     upstream status and the model;
 *   - the degraded response carries the stable reason code and the outage
 *     message, and the consumed quota unit is refunded.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

type LogEntry = Record<string, unknown>;

const errorLogs: LogEntry[] = [];
const alertCalls: Array<{ kind: string; detail: unknown; opts: unknown }> = [];
let quotaConsumeCalls: Array<Record<string, unknown>> = [];
let refundCalls: Array<Record<string, unknown>> = [];
let upstreamModels: string[] = [];

const PLAYER_MESSAGE =
  'The Dungeon Master is unavailable right now. Your turn was not lost; try again in a few minutes.';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'key-limit-chain-user', email: 'keylimit-chain@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      errorLogs.push(entry as LogEntry);
    }
  },
  child: () => testLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../lib/alerting.js', () => ({
  alert: (kind: string, detail: unknown, opts: unknown) => {
    alertCalls.push({ kind, detail, opts });
  },
}));
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async (input: Record<string, unknown>) => {
      quotaConsumeCalls.push(input);
      return { allowed: true, remaining: 9, resetAt: new Date(Date.now() + 60_000), usageId: 201 };
    },
    refundQuota: async (input: Record<string, unknown>) => {
      refundCalls.push(input);
    },
    recordProviderUsage: async () => 202,
    deleteUsageRows: async () => ({ deleted: 0 }),
  },
}));
mock.module('../../../lib/user-plan.js', () => ({
  resolveUserPlanStrict: async () => 'free',
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { resetCircuitBreakersForTests } = await import('../../../utils/circuit-breaker.js');
const { resetProviderKeyLimitForTests } = await import('../../../services/llm-provider-service.js');
const app = createRequestPipelineApp().use(llmRoutes);

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

// The body LlmApiClient.generateText sends for a DM turn.
const dmTurnBody = JSON.stringify({
  prompt: 'The party enters the banquet hall. What do they see?',
  player_input: 'I look around',
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

beforeEach(() => {
  errorLogs.length = 0;
  alertCalls.length = 0;
  quotaConsumeCalls = [];
  refundCalls = [];
  upstreamModels = [];
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_TEXT_MODEL = 'primary/model';
  process.env.OPENROUTER_FALLBACK_MODELS = 'secondary/model,tertiary/model';
  // Keep the breaker closed so this turn really walks the whole chain.
  process.env.CB_FAILURE_THRESHOLD = '100';
  resetCircuitBreakersForTests();
  resetProviderKeyLimitForTests();
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const sent = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (typeof sent.model === 'string') upstreamModels.push(sent.model);
    return new Response('Key limit exceeded', { status: 403 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('POST /v1/llm/generate with the whole chain at a key limit (#350)', () => {
  it('logs LLM_PROVIDER_KEY_LIMIT once for the turn and returns the stable code', async () => {
    const response = await postGenerate();
    const body = (await response.json()) as Record<string, unknown>;

    // Every model in the chain was tried and refused with 403.
    expect(new Set(upstreamModels)).toEqual(
      new Set(['primary/model', 'secondary/model', 'tertiary/model']),
    );

    // The distinct line: exactly once, with the upstream status and the model.
    const keyLimitLines = errorLogs.filter((entry) => entry.msg === 'LLM_PROVIDER_KEY_LIMIT');
    expect(keyLimitLines).toHaveLength(1);
    expect(keyLimitLines[0]).toMatchObject({
      provider: 'openrouter',
      model: 'primary/model',
      upstreamStatus: 403,
    });

    // The ops alert path fired once for this turn.
    expect(alertCalls).toHaveLength(1);

    // The degraded response: HTTP 200, stable reason code, outage message.
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      parsed: false,
      degraded: true,
      reason: 'llm_provider_key_limit',
      text: PLAYER_MESSAGE,
    });

    // The turn never reached a model, so the quota unit is given back.
    expect(quotaConsumeCalls).toHaveLength(1);
    expect(refundCalls).toHaveLength(1);
  });
});
