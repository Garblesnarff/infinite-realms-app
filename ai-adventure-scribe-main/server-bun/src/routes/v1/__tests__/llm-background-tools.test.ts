import { afterEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'fallback-user', plan: 'free' },
    error: null,
  }),
}));

const loggedErrors: Record<string, unknown>[] = [];
const loggedWarns: Record<string, unknown>[] = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (entry: unknown) => {
    if (entry && typeof entry === 'object') loggedWarns.push(entry as Record<string, unknown>);
  },
  error: (entry: unknown) => {
    if (entry && typeof entry === 'object') loggedErrors.push(entry as Record<string, unknown>);
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
mock.module('../../../lib/alerting.js', () => ({ alert: () => {} }));
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

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { resetCircuitBreakersForTests } = await import('../../../utils/circuit-breaker.js');

const app = createRequestPipelineApp().use(llmRoutes);

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('#759 background tool through the real LLM route', () => {
  it.each([
    ["I pick the lock with my thieves' tools", "Thieves' Tools check to pick the lock"],
    ["Can I pick the lock with my thieves' tools?", 'Sleight of Hand to pick the lock'],
    ["I do not pick the lock with my thieves' tools", 'Sleight of Hand to pick the lock'],
  ])('preserves only a declared tool action: %s', async (input, expectedPurpose) => {
    resetCircuitBreakersForTests();
    process.env.OPENROUTER_API_KEY = 'fixture-key';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-4-5';
    delete process.env.LLM_FIXTURE_DIR;
    const reply = {
      text: 'Try the lock.',
      options: [],
      narration_segments: [],
      roll_requests: [
        {
          type: 'check',
          formula: '1d20+2',
          purpose: 'Sleight of Hand to pick the lock',
          dc: 16,
          ac: null,
          advantage: false,
          disadvantage: false,
        },
      ],
      combat_transition: 'none',
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
    };
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ function: { name: 'dm_reply', arguments: JSON.stringify(reply) } }],
              },
            },
          ],
          usage: {},
        }),
        { headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input, player_input: input }),
      }),
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    const envelope = JSON.parse(result.text);
    expect(envelope.roll_requests[0].type).toBe('check');
    expect(envelope.roll_requests[0].purpose).toBe(expectedPurpose);
  });
});
