import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

let extractedInput: Record<string, unknown> | undefined;
let extractionResult: Record<string, unknown> = {
  text: '{"memories":[]}',
  provider: 'openrouter',
  model: 'fallback/model',
};
let loggedWarnEntries: Record<string, unknown>[] = [];
const alerts: Array<{ kind: string; detail: Record<string, unknown> }> = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'extract-user', email: 'extract@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/alerting.js', () => ({
  alert: (kind: string, detail: Record<string, unknown> = {}) => {
    alerts.push({ kind, detail });
  },
}));
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (msg: unknown) => {
    if (msg && typeof msg === 'object') loggedWarnEntries.push(msg as Record<string, unknown>);
  },
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
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    extract: async (input: Record<string, unknown>) => {
      extractedInput = input;
      return extractionResult;
    },
    generate: async () => ({ text: '', provider: 'openrouter', model: 'test/model' }),
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

const extractRequest = (): Request =>
  new Request('http://localhost/v1/llm/extract', {
    method: 'POST',
    headers: { authorization: 'Bearer extract-token', 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'extract memories from this exchange' }),
  });

describe('POST /v1/llm/extract HTTP contract', () => {
  beforeEach(() => {
    alerts.length = 0;
    extractionResult = {
      text: '{"memories":[]}',
      provider: 'openrouter',
      model: 'fallback/model',
    };
  });

  it('clamps the client maxTokens to 1500 and keeps a normal 1200', async () => {
    const send = (maxTokens: number): Promise<Response> =>
      app.handle(
        new Request('http://localhost/v1/llm/extract', {
          method: 'POST',
          headers: { authorization: 'Bearer extract-token', 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'extract memories from this exchange', maxTokens }),
        }),
      );

    await send(1200);
    expect(extractedInput?.maxTokens).toBe(1200);
    await send(1_000_000);
    expect(extractedInput?.maxTokens).toBe(1500);
  });

  it('uses 1000 when the client sends no maxTokens, and warns only when it clamps', async () => {
    loggedWarnEntries = [];
    const post = (body: Record<string, unknown>): Promise<Response> =>
      app.handle(
        new Request('http://localhost/v1/llm/extract', {
          method: 'POST',
          headers: { authorization: 'Bearer extract-token', 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: 'extract memories from this exchange', ...body }),
        }),
      );

    await post({});
    expect(extractedInput?.maxTokens).toBe(1000);
    expect(loggedWarnEntries).toEqual([]);

    await post({ maxTokens: 1_000_000 });
    expect(loggedWarnEntries).toEqual([
      {
        msg: 'LLM_CLIENT_INPUT_REPLACED',
        route: 'extract',
        userId: 'extract-user',
        modelDropped: false,
        clamped: true,
      },
    ]);
  });

  it('returns a degraded memory envelope instead of 502 when all models fail', async () => {
    extractionResult = {
      error: 'All extraction models failed',
      status: 404,
      provider: 'openrouter',
      model: 'fallback/model',
      upstreamStatus: 404,
      retryable: false,
      text: '',
    };

    const response = await app.handle(extractRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      memories: [],
      degraded: true,
      reason: 'memory_extraction_unavailable',
    });
    expect(alerts).toEqual([
      { kind: 'llm_extraction_degraded', detail: { error: 'All extraction models failed' } },
    ]);
  });
});
