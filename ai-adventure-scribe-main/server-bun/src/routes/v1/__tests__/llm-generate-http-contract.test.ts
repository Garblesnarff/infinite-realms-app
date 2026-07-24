import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

let generatedInput: Record<string, unknown> | undefined;
let generatedResult: Record<string, unknown> = {
  text: 'The frozen guests smell faintly of winter roses. What do you do?',
  provider: 'openrouter',
  model: 'test/model',
};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'smoke-user', email: 'smoke@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
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
    generate: async (input: Record<string, unknown>) => {
      generatedInput = input;
      return generatedResult;
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

describe('POST /v1/llm/generate HTTP contract', () => {
  it('accepts a realistic gameplay payload through the production serializer', async () => {
    const prompt =
      'You are the dungeon master for a D&D 5e game. The party enters a candlelit banquet hall where every guest is frozen. Describe one sensory detail and ask what the player does.';
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          maxTokens: 120,
          temperature: 0.4,
          provider: 'openrouter',
          requestType: 'user',
        }),
      }),
    );
    const raw = await response.text();
    const body = JSON.parse(raw) as { text?: unknown; provider?: unknown; model?: unknown };

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(typeof body.text).toBe('string');
    expect(body.provider).toBe('openrouter');
    expect(body.model).toBe('test/model');
    expect(String(body.text).trim().length).toBeGreaterThan(0);
    expect(generatedInput?.prompt).toBe(prompt);
  });

  it('returns a retryable Gemini failure as a structured 502 with a retry hint', async () => {
    generatedResult = {
      text: '',
      error: 'LLM request failed',
      provider: 'gemini',
      model: 'gemini-2.5-flash-lite',
      upstreamStatus: 429,
      retryable: true,
      retryAfter: 3,
    };
    try {
      const response = await app.handle(new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      }));
      const body = await response.json() as Record<string, unknown>;

      expect(response.status).toBe(502);
      expect(response.headers.get('retry-after')).toBe('3');
      expect(body).toMatchObject({
        error: 'upstream_model_error',
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        retryable: true,
        retry_after: 3,
      });
    } finally {
      generatedResult = {
        text: 'The frozen guests smell faintly of winter roses. What do you do?',
        provider: 'openrouter',
        model: 'test/model',
      };
    }
  });
});
