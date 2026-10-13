import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// #262: a typed defensive declaration ("I dodge", "I yield") must reach the DM as a
// structured directive while a fight is active. The client only sends combatEntry when
// combat is NOT active, so the gate has to be the live encounter, not combatEntry.

let generatedPrompts: string[] = [];

// The live encounter the mocked service returns. Tests set `mockActiveEncounter`
// before each request; undefined means no fight is active.
let mockActiveEncounter: { id: string } | undefined;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'defense-user', email: 'defense@example.test', plan: 'free' },
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
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async (args: { prompt: string }) => {
      generatedPrompts.push(args.prompt);
      return { text: 'The DM narrates.', provider: 'openrouter', model: 'test/model' };
    },
  },
}));
// Mock the combat encounter service: the fixture below follows the real producer,
// CombatEncounterService.getActiveEncounter
// (server-bun/src/services/combat/combat-encounter-service.ts), which selects the
// active combatEncounters row for the session.
mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getLatestConcludedEncounter: async () => undefined,
    getActiveEncounter: async () => mockActiveEncounter,
  },
}));

// Route contract tests stub persistence; roll serialization is exercised with real PostgreSQL.
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

const postGenerate = (body: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

// Wire body the client really sends (src/infrastructure/api/rest-client.ts
// LlmApiClient.generateText via src/services/ai-service.ts chatWithDM). Note: no
// combatEntry — the client only sends it when combat is NOT active.
const dmTurnBody = (playerInput: string): Record<string, unknown> => ({
  prompt: 'The fight rages on.',
  player_input: playerInput,
  maxTokens: 8192,
  temperature: 0.9,
  provider: 'openrouter',
  requestType: 'user',
  sessionId: 'session-defense-1',
});

describe('#262 declared-defense directive on /v1/llm/generate', () => {
  it('appends the dodge directive when a fight is active', async () => {
    mockActiveEncounter = { id: 'encounter-defense-1' };
    generatedPrompts = [];

    const response = await postGenerate(dmTurnBody('I dodge'));

    expect(response.status).toBe(200);
    expect(generatedPrompts).toHaveLength(1);
    expect(generatedPrompts[0]).toContain('<declared_defense type="dodge">');
    expect(generatedPrompts[0]).toContain("Emit a combat_action of type 'dodge'");
  });

  it('does not append the directive when no fight is active', async () => {
    mockActiveEncounter = undefined;
    generatedPrompts = [];

    const response = await postGenerate(dmTurnBody('I dodge'));

    expect(response.status).toBe(200);
    expect(generatedPrompts).toHaveLength(1);
    expect(generatedPrompts[0]).not.toContain('<declared_defense');
  });

  it("directs yield at a combat_action of type 'yield', like dodge", async () => {
    mockActiveEncounter = { id: 'encounter-defense-1' };
    generatedPrompts = [];

    const response = await postGenerate(dmTurnBody('I yield'));

    expect(response.status).toBe(200);
    expect(generatedPrompts).toHaveLength(1);
    expect(generatedPrompts[0]).toContain('<declared_defense type="yield">');
    expect(generatedPrompts[0]).toContain("combat_action of type 'yield'");
    // #262: the old directive aimed at combat_transition:'end' with a player
    // combat_exits entry, which the end guard drops — the prompt and the guard
    // disagreed. The yield now travels as the intent the inline option sends.
    expect(generatedPrompts[0]).not.toContain("combat_transition:'end'");
    expect(generatedPrompts[0]).not.toContain('combat_exits');
  });

  it("detects 'I surrender' as a yield declaration", async () => {
    mockActiveEncounter = { id: 'encounter-defense-1' };
    generatedPrompts = [];

    const response = await postGenerate(dmTurnBody('I surrender'));

    expect(response.status).toBe(200);
    expect(generatedPrompts).toHaveLength(1);
    expect(generatedPrompts[0]).toContain('<declared_defense type="yield">');
    expect(generatedPrompts[0]).toContain("combat_action of type 'yield'");
  });

  it("directs flee at a combat_action of type 'flee'", async () => {
    mockActiveEncounter = { id: 'encounter-defense-1' };
    generatedPrompts = [];

    const response = await postGenerate(dmTurnBody('I flee'));

    expect(response.status).toBe(200);
    expect(generatedPrompts).toHaveLength(1);
    expect(generatedPrompts[0]).toContain('<declared_defense type="flee">');
    expect(generatedPrompts[0]).toContain("combat_action of type 'flee'");
    expect(generatedPrompts[0]).not.toContain("combat_transition:'end'");
  });
});
