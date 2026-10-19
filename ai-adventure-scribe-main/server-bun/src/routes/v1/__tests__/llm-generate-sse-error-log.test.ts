/**
 * #783 task A(a): SSE error event logging.
 *
 * Drives the REAL POST /v1/llm/generate handler through a failing turn
 * (provider throws AppError) and asserts:
 *  (a) the SSE stream contains an `error` event,
 *  (b) the server log carries an `LLM_GENERATE_SSE_ERROR` line with the
 *      status code and message, so failed turns are visible in the logs.
 *
 * No live provider calls: the provider service is stubbed to throw.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'sse-error-user', email: 'sse-error@example.test', plan: 'free' },
    error: null,
  }),
}));

// Capture error-level log lines so the test can assert the new log line fires.
const loggedErrors: Record<string, unknown>[] = [];
const capturingLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (entry: unknown) => {
    if (entry && typeof entry === 'object') loggedErrors.push(entry as Record<string, unknown>);
  },
  child: () => capturingLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: capturingLogger,
  combatLogger: capturingLogger,
  spellLogger: capturingLogger,
  progressionLogger: capturingLogger,
  errorLogSerializers: {},
  default: capturingLogger,
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

// The provider throws an AppError mid-turn, which the route must translate
// into an SSE `error` event (and now a log line).
const { AppError } = await import('../../../lib/errors.js');
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => {
      throw new AppError(503, 'Provider overloaded');
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');

const app = createRequestPipelineApp().use(llmRoutes);

describe('POST /v1/llm/generate SSE error logging (#783)', () => {
  beforeEach(() => {
    loggedErrors.length = 0;
  });

  it('logs LLM_GENERATE_SSE_ERROR when the stream sends an error event', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'You stand at the tavern door.',
          sessionId: 'session-sse-error',
          stream: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const text = await response.text();

    // The stream carries the error event to the client.
    expect(text).toContain('"type":"error"');
    expect(text).toContain('Provider overloaded');

    // And the server log carries the new LLM_GENERATE_SSE_ERROR line.
    const sseErrorLines = loggedErrors.filter((e) => e.msg === 'LLM_GENERATE_SSE_ERROR');
    expect(sseErrorLines.length).toBeGreaterThan(0);
    const line = sseErrorLines[0] as Record<string, unknown>;
    expect(line.statusCode).toBe(503);
    expect(line.message).toBe('Provider overloaded');
    expect(line.sessionId).toBe('session-sse-error');
  });
});
