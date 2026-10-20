/**
 * #849 (audit F19): the tactical-context GET hands the client a `deliveryToken`
 * with its one-shot facts, and the client's next generate echoes it back, which is
 * what finally deletes the batch. AGENTS.md §4: a PR that changes what the client
 * sends to a server route is only proven by a test that sends that exact body
 * through the real route — a mocked API is how #2250's body shipped a 422.
 *
 * The body below is `LlmApiClient.generateText`'s wire shape for a DM turn
 * (src/infrastructure/api/rest-client.ts:697ff) as assembled by
 * `ai-service.chatWithDM` (temperature 0.9, maxTokens 8192, sessionId always sent),
 * plus the `tacticalDeliveryToken` that `use-ai-response` stashes into gameState
 * from the context response. JSON.stringify drops undefined fields, as in
 * production. The provider, quota and persistence seams are stubbed; the body
 * schema and the confirm hook under test are the real ones.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const confirmCalls: Array<{ sessionId: string; token: string }> = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'smoke-user', email: 'smoke@example.test', plan: 'free' },
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
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
/** The provider seam: mutated by the failure-case test. Never retryable. */
let providerResult: Record<string, unknown> = {
  text: 'The frozen guests smell faintly of winter roses. What do you do?',
  provider: 'openrouter',
  model: 'test/model',
};
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => providerResult,
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
// The confirm the route lazy-imports; recording stands in for the real one, whose
// own behaviour (delete exactly the matching batch) is covered by the real-DB
// suite `tactical-context-delivery.real-db.test.ts`.
mock.module('../../../services/combat/tactical-action-service.js', () => ({
  confirmTacticalContextDelivery: async (sessionId: string, token: string) => {
    confirmCalls.push({ sessionId, token });
    return true;
  },
  recordDmTacticalFact: async () => {},
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

// Obviously synthetic (repo rule: no session-id-shaped literals in committed
// files). The route treats sessionId as an opaque string.
const SESSION_ID = 'session-849-test';
// Not a secret-shaped string: this fixture is the echo token the client sends,
// and gitleaks must stay silent on this file.
const DELIVERY_TOKEN = 'delivery-token-849-test-confirmation';

const dmTurnBody = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    prompt: 'The party enters the banquet hall. What do they see?',
    player_input: 'I look around',
    model: undefined,
    maxTokens: 8192,
    temperature: 0.9,
    history: undefined,
    provider: 'openrouter',
    responseSchema: undefined,
    requestType: 'user',
    metrics: undefined,
    sessionId: SESSION_ID,
    combatEntry: undefined,
    ...overrides,
  });

const postGenerate = (body: string): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer smoke', 'content-type': 'application/json' },
      body,
    }),
  );

/** The confirm hook is detached by design; give it a few turns of the loop. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('#849 tactical delivery token on POST /v1/llm/generate', () => {
  it('accepts the body the client sends and confirms the delivery it carries', async () => {
    confirmCalls.length = 0;
    const response = await postGenerate(
      dmTurnBody({ tacticalDeliveryToken: DELIVERY_TOKEN }),
    );

    expect(response.status).toBe(200);
    await settle();
    expect(confirmCalls).toEqual([{ sessionId: SESSION_ID, token: DELIVERY_TOKEN }]);
  });

  it('a generate without the token (older client) confirms nothing', async () => {
    confirmCalls.length = 0;
    const response = await postGenerate(dmTurnBody({}));

    expect(response.status).toBe(200);
    await settle();
    expect(confirmCalls).toEqual([]);
  });

  it('a degraded (errored) turn carrying the token does NOT confirm delivery', async () => {
    // #849: the batch is deleted only when the turn actually narrated it — a
    // turn that never reached the model keeps its facts for the next attempt.
    providerResult = { error: 'model overloaded' };
    confirmCalls.length = 0;
    const response = await postGenerate(
      dmTurnBody({ tacticalDeliveryToken: DELIVERY_TOKEN }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.degraded).toBe(true);
    await settle();
    expect(confirmCalls).toEqual([]);
    providerResult = {
      text: 'The frozen guests smell faintly of winter roses. What do you do?',
      provider: 'openrouter',
      model: 'test/model',
    };
  });
});
