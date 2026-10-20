import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// #262: a typed defensive declaration ("I dodge", "I yield") must reach the DM as a
// structured directive while a fight is active. The client only sends combatEntry when
// combat is NOT active, so the gate has to be the live encounter, not combatEntry.

let generatedPrompts: string[] = [];
let modelReply = '';

import { createDmResponseSchema } from '../../../services/dm/dm-response-schema.js';
import { buildTacticalPrompt } from '../../../tactical/prompt.js';

import type { TacticalMap } from '../../../tactical/types.js';

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
      return { text: modelReply, provider: 'openrouter', model: 'test/model' };
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

const map: TacticalMap = {
  id: 'map',
  sessionId: 'session-defense-1',
  width: 12,
  height: 12,
  round: 1,
  sceneDescription: '',
  cells: Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, () => ({
      terrain: 'floor',
      blocksMovement: false,
      blocksSight: false,
      cover: 0,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'hero',
      name: 'Hero',
      type: 'pc',
      x: 1,
      y: 1,
      size: 'medium',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'cultist-1',
      name: 'Cultist 1',
      type: 'monster',
      x: 2,
      y: 1,
      size: 'medium',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'cultist-3',
      name: 'Cultist 3',
      type: 'monster',
      x: 3,
      y: 3,
      size: 'medium',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
};
const envelope = () => ({
  text: 'The cultists watch you.',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  combat_actions: [
    {
      actor_id: 'hero',
      action_type: 'attack',
      target_ids: ['cultist-1'],
      weapon_id: 'dagger',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    },
  ],
  combatants: [],
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  options: [],
});
const turn = async (words: string) => {
  mockActiveEncounter = { id: 'encounter-defense-1' };
  generatedPrompts = [];
  modelReply = JSON.stringify(envelope());
  const response = await postGenerate({
    ...dmTurnBody(words),
    prompt: `<tactical_context>\n${buildTacticalPrompt(map, 'hero')}\n</tactical_context>\n<immutable_game_state>{"isInCombat":true,"encounterId":"encounter-defense-1"}</immutable_game_state>`,
    responseSchema: createDmResponseSchema(),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { text: string };
  expect(generatedPrompts).toHaveLength(1);
  return JSON.parse(body.text);
};

describe('#823 player aim on the real LLM route (provider stub, no model calls)', () => {
  it('asks who to aim at rather than auto-targeting a creature for Burning Hands', async () => {
    const result = await turn('I cast Burning Hands');
    expect(result.text).toBe('Who do you aim at?');
    expect(result.combat_actions).toEqual([]);
    expect(result.roll_requests).toEqual([]);
  });
  it('asks who to aim at rather than auto-targeting Cultist 3 for Fire Bolt', async () => {
    const result = await turn('I cast Fire Bolt');
    expect(result.text).toBe('Who do you aim at?');
    expect(result.combat_actions).toEqual([]);
  });
  it('aims the cone at the named creature from the caster, not the nearest hostile', async () => {
    const result = await turn('I cast Burning Hands at Cultist 3');
    expect(result.combat_actions).toEqual([
      {
        actor_id: 'hero',
        action_type: 'cast_spell',
        spell_id: 'burning-hands',
        slot_level: 1,
        origin: { x: 1, y: 1 },
        direction: { x: 2, y: 2 },
      },
    ]);
  });
  it('accepts a compass direction for a cone', async () => {
    const result = await turn('I cast Burning Hands northeast');
    expect(result.combat_actions[0].direction).toEqual({ x: 1, y: -1 });
  });
  it('keeps Fire Bolt on its named target', async () => {
    const result = await turn('I cast Fire Bolt at Cultist 3');
    expect(result.combat_actions[0]).toMatchObject({
      spell_id: 'fire-bolt',
      target_ids: ['cultist-3'],
      weapon_id: null,
    });
  });
  it('replaces the model dagger with the declared quarterstaff', async () => {
    const result = await turn('I strike Cultist 3 with my quarterstaff');
    expect(result.combat_actions[0]).toMatchObject({
      action_type: 'attack',
      weapon_id: 'quarterstaff',
      target_ids: ['cultist-3'],
    });
    expect(result.roll_requests).toEqual([]);
  });
  it('does not invent a named weapon when the player only declares an attack', async () => {
    const result = await turn('I attack Cultist 3');
    expect(result.combat_actions[0]).toMatchObject({
      action_type: 'attack',
      weapon_id: null,
      target_ids: ['cultist-3'],
    });
  });
  it('keeps an explicit punch unarmed instead of using the model dagger', async () => {
    const result = await turn('I punch Cultist 3');
    expect(result.combat_actions[0]).toMatchObject({
      action_type: 'attack',
      weapon_id: 'unarmed-strike',
      target_ids: ['cultist-3'],
    });
  });
});
