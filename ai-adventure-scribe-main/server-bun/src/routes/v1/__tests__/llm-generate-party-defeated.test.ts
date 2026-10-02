import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// #2456: a message sent after the party was defeated must return a handled
// terminal state, not run ordinary generation and not error.

let quotaConsumed = 0;
let generatedCalls = 0;

// The concluded encounter the mocked service returns. Tests set
// `mockConcludedEncounter` before each request.
let mockConcludedEncounter: { id: string; endedReason: string | null } | undefined;
let mockActiveEncounter: { id: string } | undefined;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'defeated-user', email: 'defeated@example.test', plan: 'free' },
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
    checkQuotaAndConsume: async () => {
      quotaConsumed += 1;
      return { allowed: true, remaining: 99, resetAt: new Date(Date.now() + 60_000) };
    },
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => {
      generatedCalls += 1;
      return { text: 'The DM narrates.', provider: 'openrouter', model: 'test/model' };
    },
  },
}));
// Mock the combat encounter service: the fixture below follows the real
// producer, CombatEncounterService.getLatestConcludedEncounter /
// getActiveEncounter (server-bun/src/services/combat/combat-encounter-service.ts),
// which select the combatEncounters row for the session.
mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getLatestConcludedEncounter: async () => mockConcludedEncounter,
    getActiveEncounter: async () => mockActiveEncounter,
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

const postGenerate = (body: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

// Wire body the client really sends (src/infrastructure/api/rest-client.ts
// LlmApiClient.generateText via src/services/ai-service.ts chatWithDM).
const dmTurnBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  prompt: 'I lie still in the dark.',
  player_input: 'I lie still in the dark.',
  maxTokens: 8192,
  temperature: 0.9,
  provider: 'openrouter',
  requestType: 'user',
  sessionId: 'session-defeated-1',
  ...overrides,
});

describe('#2456 party_defeated terminal state on /v1/llm/generate', () => {
  it('returns a handled terminal state instead of running generation', async () => {
    mockConcludedEncounter = { id: 'encounter-defeated-1', endedReason: 'party_defeated' };
    mockActiveEncounter = undefined;
    quotaConsumed = 0;
    generatedCalls = 0;

    const response = await postGenerate(dmTurnBody());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.terminalState).toBe('party_defeated');
    expect(body.encounterId).toBe('encounter-defeated-1');
    // No ordinary generation ran and no quota was consumed for a dead party.
    expect(generatedCalls).toBe(0);
    expect(quotaConsumed).toBe(0);
    // Not the generic processing-error shape.
    expect(body.error).toBeUndefined();
  });

  it('runs ordinary generation when the latest concluded encounter ended another way', async () => {
    mockConcludedEncounter = { id: 'encounter-fled-1', endedReason: 'party_fled' };
    mockActiveEncounter = undefined;
    quotaConsumed = 0;
    generatedCalls = 0;

    const response = await postGenerate(dmTurnBody());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.terminalState).toBeUndefined();
    expect(generatedCalls).toBe(1);
  });

  it('runs ordinary generation when a new encounter is active after the defeat', async () => {
    mockConcludedEncounter = { id: 'encounter-defeated-2', endedReason: 'party_defeated' };
    mockActiveEncounter = { id: 'encounter-new-1' };
    generatedCalls = 0;

    const response = await postGenerate(dmTurnBody());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.terminalState).toBeUndefined();
    expect(generatedCalls).toBe(1);
  });

  it('runs ordinary generation when there is no concluded encounter', async () => {
    mockConcludedEncounter = undefined;
    mockActiveEncounter = undefined;
    generatedCalls = 0;

    const response = await postGenerate(dmTurnBody());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.terminalState).toBeUndefined();
    expect(generatedCalls).toBe(1);
  });
});
