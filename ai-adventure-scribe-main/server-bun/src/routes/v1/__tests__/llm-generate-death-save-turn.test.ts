import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { BusinessLogicError } from '../../../lib/errors.js';

// #261: the dying tray posts "Death saving throw." as a chat line. The llm
// route must resolve it through the engine (d20 rolled, tallies updated) on
// the hero's turn, instead of sending it to the DM as prose.

let generatedCalls = 0;
let executeIntentCalls: Array<{ encounterId: string; intent: unknown }> = [];
let executeIntentImpl: (() => Promise<unknown>) | undefined;
let getActiveEncounterImpl: (() => Promise<unknown>) | undefined;

// The encounter the mocked service returns. Tests set `mockEncounterState`
// before each request. Follows the real producer,
// CombatEncounterService.getActiveEncounter / getCombatState
// (server-bun/src/services/combat/combat-encounter-service.ts). The participant
// shape carries the fields vitalStateOf reads (participantType, maxHp,
// status.currentHp, status.deathSavesSuccesses/Failures).
let mockActiveEncounter: { id: string; sessionId: string } | undefined;
let mockCombatState:
  | {
      encounter: { id: string; status: string };
      participants: Array<{
        id: string;
        name: string;
        participantType: string;
        maxHp: number;
        status?: {
          currentHp: number;
          deathSavesSuccesses: number;
          deathSavesFailures: number;
        };
      }>;
      currentParticipant: { id: string; name: string } | null;
    }
  | undefined;

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'death-save-user', email: 'death-save@example.test', plan: 'free' },
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
      return { text: 'The DM narrates.', provider: 'openrouter', model: 'test/model' };
    },
  },
}));
mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getLatestConcludedEncounter: async () => undefined,
    getActiveEncounter: async () => {
      if (getActiveEncounterImpl) return getActiveEncounterImpl();
      return mockActiveEncounter;
    },
    getCombatState: async () => mockCombatState,
  },
}));
mock.module('../../../services/combat/combat-intent-service.js', () => ({
  executeCombatIntent: async (encounterId: string, intent: unknown) => {
    executeIntentCalls.push({ encounterId, intent });
    if (executeIntentImpl) return executeIntentImpl();
    // Follows the real death_save branch
    // (server-bun/src/services/combat/combat-intent-service.ts): the engine
    // rolls the d20 and advances the turn.
    return {
      deathSaves: [
        {
          participantId: 'player-1',
          roll: 14,
          isSuccess: true,
          isCritical: false,
          successes: 1,
          failures: 0,
          isStabilized: false,
          isDead: false,
          wasRevived: false,
          newCurrentHp: 0,
        },
      ],
    };
  },
}));
// The real vitalStateOf is used (not stubbed): it reads status.currentHp,
// participantType, and death-save tallies, so the test checks the production
// dying rule. Fixtures carry those fields per
// CombatEncounterService.getCombatState.
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

// Wire body the client really sends for the dying turn
// (DyingComposerSlot via onSendMessage -> use-ai-response -> ai-service).
const deathSaveTurnBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  prompt: 'Death saving throw.',
  player_input: 'Death saving throw.',
  maxTokens: 8192,
  sessionId: 'session-1',
  ...overrides,
});

const dyingEncounter = () => {
  mockActiveEncounter = { id: 'encounter-1', sessionId: 'session-1' };
  mockCombatState = {
    encounter: { id: 'encounter-1', status: 'active' },
    participants: [
      {
        id: 'player-1',
        name: 'The Apprentice',
        participantType: 'player',
        maxHp: 8,
        status: { currentHp: 0, deathSavesSuccesses: 0, deathSavesFailures: 0 },
      },
    ],
    currentParticipant: { id: 'player-1', name: 'The Apprentice' },
  };
};

describe('llm generate death-save turn (#261)', () => {
  it('resolves "Death saving throw." through the engine, not the DM', async () => {
    dyingEncounter();
    executeIntentCalls = [];
    executeIntentImpl = undefined;
    getActiveEncounterImpl = undefined;
    generatedCalls = 0;

    const res = await postGenerate(deathSaveTurnBody());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The engine ran the death_save intent: one call, with the dying player's id.
    expect(executeIntentCalls).toHaveLength(1);
    expect(executeIntentCalls[0].encounterId).toBe('encounter-1');
    expect(executeIntentCalls[0].intent).toMatchObject({
      type: 'death_save',
      actorId: 'player-1',
    });
    // The DM was never called: no LLM generation for an engine turn.
    expect(generatedCalls).toBe(0);
    // The response carries the rolled save for the transcript.
    expect(body.provider).toBe('engine');
    expect(body.text).toContain('14');
    const deathSave = body.deathSave as Record<string, unknown>;
    expect(deathSave.roll).toBe(14);
    expect(deathSave.successes).toBe(1);
    expect(deathSave.failures).toBe(0);
  });

  it('returns already-resolved from the engine when no dying turn is owed', async () => {
    // Active encounter, but the current participant is standing (e.g. a retry
    // after the save resolved and the turn advanced). The engine answers; the
    // DM never sees the raw line.
    mockActiveEncounter = { id: 'encounter-1', sessionId: 'session-1' };
    mockCombatState = {
      encounter: { id: 'encounter-1', status: 'active' },
      participants: [
        {
          id: 'player-1',
          name: 'The Apprentice',
          participantType: 'player',
          maxHp: 8,
          status: { currentHp: 8, deathSavesSuccesses: 0, deathSavesFailures: 0 },
        },
      ],
      currentParticipant: { id: 'player-1', name: 'The Apprentice' },
    };
    executeIntentCalls = [];
    executeIntentImpl = undefined;
    getActiveEncounterImpl = undefined;
    generatedCalls = 0;

    const res = await postGenerate(deathSaveTurnBody());
    expect(res.status).toBe(200);
    const body = await res.json();

    // Not a dying turn: the engine was not asked to roll, the DM was not called.
    expect(executeIntentCalls).toHaveLength(0);
    expect(generatedCalls).toBe(0);
    expect(body.provider).toBe('engine');
    expect(body.text).toContain('already been resolved');
  });

  it('returns already-resolved when the engine refuses the save', async () => {
    // The dying player holds the turn, but executeCombatIntent refuses (e.g.
    // "already recorded" on a double-submit). The engine answers; the DM never
    // narrates the raw line as prose.
    dyingEncounter();
    executeIntentCalls = [];
    executeIntentImpl = undefined;
    getActiveEncounterImpl = undefined;
    getActiveEncounterImpl = undefined;
    generatedCalls = 0;
    executeIntentImpl = async () => {
      throw new BusinessLogicError('Death save already recorded for this turn');
    };

    const res = await postGenerate(deathSaveTurnBody());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(executeIntentCalls).toHaveLength(1);
    expect(generatedCalls).toBe(0);
    expect(body.provider).toBe('engine');
    expect(body.text).toContain('already been resolved');
  });

  it('rethrows DB errors instead of claiming the save resolved', async () => {
    // A DB outage in getActiveEncounter must NOT tell the player the save is
    // done when nothing was rolled. The error propagates; the client shows it.
    dyingEncounter();
    executeIntentCalls = [];
    executeIntentImpl = undefined;
    getActiveEncounterImpl = undefined;
    generatedCalls = 0;
    getActiveEncounterImpl = async () => {
      throw new Error('database connection failed');
    };

    const res = await postGenerate(deathSaveTurnBody());
    // Not 200 with "already been resolved": the request fails.
    expect(res.status).not.toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('already been resolved');
    expect(executeIntentCalls).toHaveLength(0);
    expect(generatedCalls).toBe(0);
  });

  it('falls through to the DM when no encounter is active', async () => {
    mockActiveEncounter = undefined;
    mockCombatState = undefined;
    executeIntentCalls = [];
    executeIntentImpl = undefined;
    getActiveEncounterImpl = undefined;
    generatedCalls = 0;

    const res = await postGenerate(deathSaveTurnBody());
    expect(res.status).toBe(200);

    expect(executeIntentCalls).toHaveLength(0);
    expect(generatedCalls).toBe(1);
  });
});
