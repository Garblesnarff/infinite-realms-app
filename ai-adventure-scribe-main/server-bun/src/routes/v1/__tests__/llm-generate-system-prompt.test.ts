/**
 * #352: the `systemPrompt` body field on POST /v1/llm/generate and the
 * per-turn LLM_CACHE_TOKENS log line. The provider service is stubbed (no
 * live provider calls); the route itself is real
 * (createRequestPipelineApp().use(llmRoutes)).
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';

let generatedInput: Record<string, unknown> | undefined;
let generatedQueue: Record<string, unknown>[] = [];
const generatedResult: Record<string, unknown> = {
  text: 'The frozen guests smell faintly of winter roses. What do you do?',
  provider: 'openrouter',
  model: 'test/model',
};

let loggedInfoEntries: Record<string, unknown>[] = [];

const testLogger = {
  debug: () => {},
  info: (msg: unknown) => {
    if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
      loggedInfoEntries.push(msg as Record<string, unknown>);
    }
  },
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'smoke-user', email: 'smoke@example.test', plan: 'free' },
    error: null,
  }),
}));
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
    checkQuotaAndConsume: async () => ({ allowed: true, remaining: 99, resetAt: new Date() }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async (input: Record<string, unknown>) => {
      generatedInput = input;
      return generatedQueue.shift() || generatedResult;
    },
  },
}));
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    withRollTurn: async (
      _sessionId: string,
      _userId: string,
      _playerInput: string | undefined,
      _rollId: string | undefined,
      _replyId: string | undefined,
      generate: () => Promise<unknown>,
    ) => generate(),
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

// Exact body shape of rest-client generateText for a DM turn, with the #352
// systemPrompt field present (JSON.stringify drops undefined, as in prod).
const clientBody = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    prompt: '<game_context>volatile</game_context><player_input>I look around</player_input>',
    systemPrompt: '<persona>stable system block</persona>',
    player_input: 'I look around',
    model: undefined,
    maxTokens: 8192,
    temperature: 0.9,
    history: undefined,
    provider: 'openrouter',
    requestType: 'user',
    ...overrides,
  });

const postGenerate = (body: string): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
      body,
    }),
  );

describe('#352 systemPrompt on POST /v1/llm/generate', () => {
  beforeEach(() => {
    generatedInput = undefined;
    generatedQueue = [];
    loggedInfoEntries = [];
  });

  it('passes systemPrompt through to the provider service', async () => {
    const response = await postGenerate(clientBody({}));
    expect(response.status).toBe(200);
    expect(generatedInput?.systemPrompt).toBe('<persona>stable system block</persona>');
    expect(generatedInput?.prompt).toContain('<player_input>');
  });

  it('omits systemPrompt for older clients (backward compatible)', async () => {
    const response = await postGenerate(clientBody({ systemPrompt: undefined }));
    expect(response.status).toBe(200);
    expect(generatedInput?.systemPrompt).toBeUndefined();
  });

  it('logs LLM_CACHE_TOKENS with the cached prompt tokens per turn', async () => {
    generatedQueue.push({
      text: 'You see a banquet hall.',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
      usage: {
        inputTokens: 12000,
        outputTokens: 120,
        totalTokens: 12120,
        cachedInputTokens: 9800,
        cacheWriteTokens: 0,
      },
    });
    const response = await postGenerate(
      clientBody({ sessionId: '123e4567-e89b-12d3-a456-426614174000' }),
    );
    expect(response.status).toBe(200);
    const cacheLines = loggedInfoEntries.filter((e) => e.msg === 'LLM_CACHE_TOKENS');
    expect(cacheLines).toHaveLength(1);
    expect(cacheLines[0]).toMatchObject({
      msg: 'LLM_CACHE_TOKENS',
      sessionId: '123e4567-e89b-12d3-a456-426614174000',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
      inputTokens: 12000,
      cachedTokens: 9800,
      cacheWriteTokens: 0,
    });
  });

  it('logs zero cached tokens when the provider reports no cache hit', async () => {
    generatedQueue.push({
      text: 'You see a banquet hall.',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
      usage: { inputTokens: 12000, outputTokens: 120, totalTokens: 12120 },
    });
    const response = await postGenerate(clientBody({}));
    expect(response.status).toBe(200);
    const cacheLines = loggedInfoEntries.filter((e) => e.msg === 'LLM_CACHE_TOKENS');
    expect(cacheLines).toHaveLength(1);
    expect(cacheLines[0]).toMatchObject({ cachedTokens: 0, cacheWriteTokens: 0 });
  });

  it('does not log LLM_CACHE_TOKENS for generations without a systemPrompt', async () => {
    // Non-DM generations (narration regen, memory extraction) never carry a
    // systemPrompt; they must not dilute the DM hit-rate metric.
    generatedQueue.push({
      text: 'You see a banquet hall.',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-lite',
      usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550, cachedInputTokens: 400 },
    });
    const response = await postGenerate(clientBody({ systemPrompt: undefined }));
    expect(response.status).toBe(200);
    const cacheLines = loggedInfoEntries.filter((e) => e.msg === 'LLM_CACHE_TOKENS');
    expect(cacheLines).toHaveLength(0);
  });
});
