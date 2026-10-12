/**
 * #350: a turn degraded by a provider key/credit limit shows the plain
 * maintenance message and does not consume the player's daily DM quota.
 * Through the real route (createRequestPipelineApp + llmRoutes); only the
 * provider service and the usage store are stubbed — never a live DM call.
 *
 * The stubbed provider failure mirrors the real chain-exhausted return from
 * LLMProviderService.generateOpenRouter (services/llm-provider-service.ts):
 * error/status/provider/model/upstreamStatus/retryable/details/text.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const PLAYER_MESSAGE = 'The storyteller is offline for maintenance. Your turn was not used.';

let quotaConsumeCalls: Array<Record<string, unknown>> = [];
let refundCalls: Array<Record<string, unknown>> = [];
let providerGenerateCalls = 0;
// The stubbed provider's answer for the next generate call.
let stubbedProviderResult: Record<string, unknown> = {};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'key-limit-user', email: 'keylimit@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
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
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async (input: Record<string, unknown>) => {
      quotaConsumeCalls.push(input);
      return { allowed: true, remaining: 9, resetAt: new Date(Date.now() + 60_000), usageId: 101 };
    },
    refundQuota: async (input: Record<string, unknown>) => {
      refundCalls.push(input);
    },
    recordProviderUsage: async () => 102,
    deleteUsageRows: async () => ({ deleted: 0 }),
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => {
      providerGenerateCalls += 1;
      return { ...stubbedProviderResult };
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

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

const postGenerateWith = (extra: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify({ ...JSON.parse(dmTurnBody), ...extra }),
    }),
  );

/** The real chain-exhausted shape for an upstream 403 "Key limit exceeded". */
const chainExhaustedKeyLimit = {
  error: 'LLM request failed',
  status: 403,
  provider: 'openrouter',
  model: 'primary/model',
  upstreamStatus: 403,
  retryable: false,
  providerKeyLimit: true,
  details: 'Key limit exceeded',
  attempts: ['primary/model', 'secondary/model', 'tertiary/model'],
  text: '',
};

/** A non-limit failure: same shape, upstream 400 (not retryable, no extra wait). */
const chainExhaustedClientError = {
  ...chainExhaustedKeyLimit,
  status: 400,
  upstreamStatus: 400,
  retryable: false,
  providerKeyLimit: false,
  details: 'bad request',
};

/**
 * The real breaker-open fast-fail shape while the key is known dead
 * (#350 B1): the circuit opened after 3 consecutive key-limit failures, so
 * this turn never reached the chain — but it still carries the signal.
 */
const breakerOpenKeyLimit = {
  error: 'Provider temporarily unavailable',
  status: 503,
  provider: 'openrouter',
  retryAfter: 30,
  upstreamStatus: 403,
  providerKeyLimit: true,
  text: '',
};

describe('POST /v1/llm/generate degraded by a provider key limit (#350)', () => {
  it('shows the maintenance message and refunds the consumed quota unit', async () => {
    quotaConsumeCalls = [];
    refundCalls = [];
    providerGenerateCalls = 0;
    stubbedProviderResult = chainExhaustedKeyLimit;

    const response = await postGenerate();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.degraded).toBe(true);
    expect(body.parsed).toBe(false);
    expect(body.text).toBe(PLAYER_MESSAGE);
    // The turn consumed one quota unit up front…
    expect(quotaConsumeCalls).toEqual([
      { userId: 'key-limit-user', plan: 'free', type: 'llm', units: 1 },
    ]);
    // …and got it back: the player's daily DM quota is untouched.
    expect(refundCalls).toEqual([
      { userId: 'key-limit-user', plan: 'free', type: 'llm', units: 1 },
    ]);
  });

  it('honours the key-limit signal on the breaker-open fast fail (#350 B1)', async () => {
    quotaConsumeCalls = [];
    refundCalls = [];
    providerGenerateCalls = 0;
    stubbedProviderResult = breakerOpenKeyLimit;

    const response = await postGenerate();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.degraded).toBe(true);
    expect(body.text).toBe(PLAYER_MESSAGE);
    expect(refundCalls).toEqual([
      { userId: 'key-limit-user', plan: 'free', type: 'llm', units: 1 },
    ]);
    // #350 B1: a key-limit failure is never worth the #312 retry — the key is
    // dead, so retrying only burns up to 5s into a still-open breaker.
    expect(providerGenerateCalls).toBe(1);
  });

  it('keeps the generic failure message and the spent quota for non-limit failures', async () => {
    quotaConsumeCalls = [];
    refundCalls = [];
    stubbedProviderResult = chainExhaustedClientError;

    const response = await postGenerate();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.degraded).toBe(true);
    expect(body.text).not.toBe(PLAYER_MESSAGE);
    expect(body.text).toContain('try your action again');
    expect(quotaConsumeCalls).toHaveLength(1);
    expect(refundCalls).toHaveLength(0);
  });

  it('shows the maintenance message when the turn carries a dmReply (#350 N5)', async () => {
    quotaConsumeCalls = [];
    refundCalls = [];
    stubbedProviderResult = chainExhaustedKeyLimit;

    // A DM reply is present, so the feature/combat gates run — they must pass
    // an error result through untouched to the degraded branch.
    const response = await postGenerateWith({
      dmReply: { messageId: '123e4567-e89b-12d3-a456-426614174000', inCombat: false },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.degraded).toBe(true);
    expect(body.text).toBe(PLAYER_MESSAGE);
    expect(refundCalls).toEqual([
      { userId: 'key-limit-user', plan: 'free', type: 'llm', units: 1 },
    ]);
  });

  it('carries the ai_usage row ids back so the deploy smoke can delete them (#350 FIX round 2)', async () => {
    quotaConsumeCalls = [];
    stubbedProviderResult = {
      text: '{"text": "You see a long banquet hall."}',
      provider: 'openrouter',
      model: 'test/model',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const response = await postGenerate();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.degraded ?? false).toBe(false);
    expect(body.parsed).toBe(true);
    // The quota row id (101) and the usage-detail row id (102) from the
    // stubbed usage store.
    expect(body.usageIds).toEqual([101, 102]);
  });

  it('reports parsed:false when the model text has no envelope (#350 nit)', async () => {
    quotaConsumeCalls = [];
    stubbedProviderResult = {
      text: 'just some prose with no JSON envelope at all',
      provider: 'openrouter',
      model: 'test/model',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const response = await postGenerate();

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.degraded ?? false).toBe(false);
    // A hardcoded `parsed: true` would let this prose-only reply pass the
    // deploy smoke's parsed=true check; the real value must be false.
    expect(body.parsed).toBe(false);
  });
});
