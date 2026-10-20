import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// #874: after the engine resolves a dying player's death save, the client
// asks the DM to narrate the settled turn. That narration call's `message`
// is the machine-built resolution payload (JSON of engine results), and the
// client used to send it as the body's `player_input` — capped at 20000
// chars because the field is the player's raw input. The payload passes the
// cap in any real fight, so every death-save Roll 422'd and the player saw
// "I encountered an issue processing your message." The fix is client-side:
// a resolution-only turn sends no `player_input` (the payload rides inside
// the prompt, where this route's extract-from-prompt fallback reads it).
// The bodies here come from the shared fixture
// (shared/test-fixtures/death-save-narration-payload.ts), built from the
// real producers; the client half asserts ai-service sends exactly the
// no-player_input body.

let generatedCalls = 0;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'narration-user', email: 'narration@example.test', plan: 'free' },
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
      return { allowed: true, remaining: 99, resetAt: new Date(Date.now() + 60_000) };
    },
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async () => {
      generatedCalls += 1;
      return { text: 'The DM narrates the settled turn.', provider: 'openrouter', model: 'test/model' };
    },
  },
}));
mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getLatestConcludedEncounter: async () => undefined,
    getActiveEncounter: async () => undefined,
    getCombatState: async () => undefined,
  },
}));
mock.module('../../../services/combat/combat-intent-service.js', () => ({
  executeCombatIntent: async () => ({}),
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
const {
  buildDeathSaveNarrationPayload,
  buildNarrationGenerateBody,
} = await import('../../../../../shared/test-fixtures/death-save-narration-payload');
const app = createRequestPipelineApp().use(llmRoutes);

const postGenerate = (body: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('llm generate resolution narration (#874)', () => {
  it('accepts the post-fix narration body: no player_input, payload in the prompt', async () => {
    generatedCalls = 0;
    // Four creatures standing — the payload the real producers build is
    // ~40k chars. If it ever shrinks under the cap, this test stops proving
    // the bug; fail loudly instead.
    const payload = buildDeathSaveNarrationPayload(4);
    expect(payload.length).toBeGreaterThan(20_000);

    const res = await postGenerate(buildNarrationGenerateBody(payload, { includePlayerInput: false }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(generatedCalls).toBe(1);
    expect(body.text).toBe('The DM narrates the settled turn.');
  });

  it('rejects the pre-fix body: the same payload sent as player_input 422s', async () => {
    generatedCalls = 0;
    const payload = buildDeathSaveNarrationPayload(4);

    const res = await postGenerate(buildNarrationGenerateBody(payload, { includePlayerInput: true }));
    // Elysia body validation rejects before the handler runs — this is the
    // exact failure every death-save Roll hit in production.
    expect(res.status).toBe(422);
    expect(generatedCalls).toBe(0);
  });
});
