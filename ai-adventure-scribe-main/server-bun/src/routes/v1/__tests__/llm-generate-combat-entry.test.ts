/**
 * #1779 §1 — the entry gate is wired into the turn pipeline, not merely written.
 *
 * The gate's own behaviour is covered in `services/combat/__tests__/combat-entry-gate.test.ts`.
 * What this file proves is that `POST /v1/llm/generate` — the single funnel every DM turn
 * passes through — runs it against the accepted response and returns the rewritten envelope,
 * so the encounter exists before the player ever sees the turn.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const seatedEncounters: string[] = [];
let generatedResult: Record<string, unknown> = { text: '{}', provider: 'openrouter', model: 'm' };

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'entry-user', email: 'entry@example.test', plan: 'free' },
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
  LLMProviderService: { generate: async () => generatedResult },
}));

// The database-backed half of the gate. Everything above it — trigger detection, scene
// synthesis, participant assembly, envelope rewrite — is the real implementation.
mock.module('../../../services/combat/combat-entry-gate-deps.js', () => ({
  combatEntryGateDeps: {
    getActiveEncounter: async () => undefined,
    verifySessionOwnership: async () => ({ success: true }),
    startCombat: async (sessionId: string, participants: Array<{ name: string }>) => {
      seatedEncounters.push(sessionId);
      return {
        encounter: { id: 'encounter-http-1' },
        participants: participants.map((participant, index) => ({
          id: `participant-${index}`,
          name: participant.name,
        })),
        participantSizes: {},
      };
    },
    createTacticalCombatMap: async () => ({}),
    sanitizeSceneSpec: (raw: unknown) => ({ ok: true, sceneSpec: raw, overrides: [] }),
    trackCombatEvent: () => {},
    publishCombatState: async () => undefined,
    logger: testLogger,
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const COMBAT_ENTRY = {
  sessionId: SESSION_ID,
  player: { characterId: 'char-1', name: 'The Storyteller', initiativeModifier: 2 },
};

const dmEnvelope = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    text: "Your fist lands with a sickening squelch. Dishwasher Prime doesn't seem hurt.",
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    scene_spec: null,
    map_actions: [],
    handout_actions: [],
    combatants: [],
    combat_actions: [],
    ...overrides,
  });

const generate = async (body: Record<string, unknown>) =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer smoke-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/llm/generate — combat entry gate', () => {
  beforeEach(() => {
    seatedEncounters.length = 0;
  });

  it('seats an encounter for a hostile turn and returns a rewritten envelope', async () => {
    generatedResult = {
      text: dmEnvelope({
        combat_actions: [
          {
            actor_id: 'the-storyteller',
            action_type: 'attack',
            target_ids: ['dishwasher-prime'],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ],
      }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({ prompt: 'I punch it', combatEntry: COMBAT_ENTRY });
    const body = (await response.json()) as { text: string };

    expect(response.status).toBe(200);
    expect(seatedEncounters).toEqual([SESSION_ID]);

    const envelope = JSON.parse(body.text) as Record<string, unknown>;
    expect(envelope.combat_transition).toBe('start');
    expect(envelope.scene_spec).toBeTruthy();
    expect(envelope.combat_entry).toMatchObject({
      entered: true,
      encounterId: 'encounter-http-1',
      trigger: 'tactical_action',
      sceneSpecSynthesized: true,
    });
  });

  it('leaves a peaceful turn untouched', async () => {
    generatedResult = {
      text: dmEnvelope({
        roll_requests: [
          {
            type: 'check',
            formula: '1d20+3',
            purpose: 'Investigation',
            dc: 12,
            ac: null,
            advantage: false,
            disadvantage: false,
          },
        ],
      }),
      provider: 'openrouter',
      model: 'test/model',
    };

    const response = await generate({ prompt: 'I search the kitchen', combatEntry: COMBAT_ENTRY });
    const body = (await response.json()) as { text: string };
    expect(seatedEncounters).toHaveLength(0);
    expect((JSON.parse(body.text) as Record<string, unknown>).combat_entry).toBeUndefined();
  });

  it('stays backward compatible with clients that send no combatEntry', async () => {
    generatedResult = {
      text: dmEnvelope({ combat_transition: 'start' }),
      provider: 'openrouter',
      model: 'test/model',
    };
    const response = await generate({ prompt: 'I punch it' });
    expect(response.status).toBe(200);
    expect(seatedEncounters).toHaveLength(0);
  });
});
