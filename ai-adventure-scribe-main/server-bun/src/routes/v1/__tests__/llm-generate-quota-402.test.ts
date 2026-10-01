import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import {
  QUOTA_RESET_AT,
  quotaExceededBody,
} from '../../../../../shared/test-fixtures/llm-quota-exceeded';

let generateCalls = 0;
const quotaCalls: Array<Record<string, unknown>> = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'quota-user', email: 'quota@example.test', plan: 'free' },
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
// The service's own answer when the day's budget is spent: `allowed: false` and the reset `Date`.
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async (input: Record<string, unknown>) => {
      quotaCalls.push(input);
      return { allowed: false, remaining: 0, resetAt: new Date(QUOTA_RESET_AT) };
    },
    recordProviderUsage: async () => {},
  },
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
const app = createRequestPipelineApp().use(llmRoutes);

// The body `LlmApiClient.generateText` sends for a DM turn (as in llm-generate-http-contract).
const dmTurnBody = JSON.stringify({
  prompt: 'The party enters the banquet hall. What do they see?',
  player_input: 'I cast Acid Splash at the Bitter End Mercenary',
  maxTokens: 8192,
  temperature: 0.9,
  provider: 'openrouter',
  requestType: 'user',
});

describe('POST /v1/llm/generate with the daily quota spent (#2443)', () => {
  it('answers 402 with the body and Retry-After the client reads, and calls no model', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
        body: dmTurnBody,
      }),
    );

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual(quotaExceededBody);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(quotaCalls).toEqual([{ userId: 'quota-user', plan: 'free', type: 'llm', units: 1 }]);
    expect(generateCalls).toBe(0);
  });
});
