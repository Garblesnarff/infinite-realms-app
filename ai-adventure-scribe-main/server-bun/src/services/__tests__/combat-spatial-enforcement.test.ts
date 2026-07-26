import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { buildTacticalPrompt } from '../../tactical/prompt.js';

import type { TacticalMap } from '../../tactical/types.js';
import type { DMResponse } from '../dm/dm-response-schema.js';

type GenerateArgs = { prompt: string };
const generate = mock(async (_params: GenerateArgs) => ({
  text: '',
  provider: 'openrouter' as const,
}));
const warnings: Array<Record<string, unknown>> = [];
const errors: Array<Record<string, unknown>> = [];

mock.module('../llm-provider-service.js', () => ({
  LLMProviderService: { generate },
}));
mock.module('../../lib/logger.js', () => ({
  logger: {
    warn: (entry: Record<string, unknown>) => warnings.push(entry),
    error: (entry: Record<string, unknown>) => errors.push(entry),
    info: () => undefined,
    debug: () => undefined,
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  // Module mocks are process-wide: sibling suites import `combatLogger` from this same
  // module, so the stub has to export everything the real one does.
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { enforceCombatTransitionContract } = await import('../combat-transition-enforcement.js');

const map = (): TacticalMap => ({
  id: 'map',
  sessionId: 'session',
  width: 10,
  height: 10,
  round: 1,
  sceneDescription: 'test',
  // Column 4 is solid wall: the only spatial breach the engine cannot dissolve by walking is
  // a ranged attack through something you cannot see through.
  cells: Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, (_unused, x) => ({
      terrain: x === 4 ? ('wall' as const) : ('floor' as const),
      blocksMovement: x === 4,
      blocksSight: x === 4,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'seeker',
      name: 'The Seeker',
      x: 1,
      y: 1,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'void-maw',
      name: 'Void-Maw',
      x: 7,
      y: 7,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});

const prompt = `<tactical_context>\n${buildTacticalPrompt(map())}\n</tactical_context>\n<immutable_game_state>{"isInCombat":true}</immutable_game_state>`;

const dmResponse = (overrides: Partial<DMResponse>): string =>
  JSON.stringify({
    text: 'Void-Maw lunges at The Seeker.',
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

const attack = {
  actor_id: 'void-maw',
  action_type: 'attack' as const,
  target_ids: ['seeker'],
  // Ranged: melee attacks in `combat_actions` are approached by the engine, not corrected.
  weapon_id: 'longbow',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const illegal = dmResponse({ combat_actions: [attack] });
const legal = dmResponse({
  map_actions: [{ action: 'move', entityId: 'void-maw', x: 3, y: 3, changes: null }],
  combat_actions: [{ ...attack, movement_feet: 25 }],
});

const enforce = (text: string) =>
  enforceCombatTransitionContract({
    result: { text, provider: 'openrouter' },
    prompt,
    maxTokens: 4000,
    temperature: 0.9,
    provider: 'openrouter',
    responseSchema: { properties: { combat_transition: {}, roll_requests: {} } },
  });

beforeEach(() => {
  generate.mockClear();
  warnings.length = 0;
  errors.length = 0;
});

describe('spatial contract enforcement in the DM transport', () => {
  test('a ranged attack with no line of sight triggers exactly one corrective re-prompt', async () => {
    generate.mockImplementation(async () => ({ text: legal, provider: 'openrouter' as const }));
    const result = await enforce(illegal);

    expect(generate).toHaveBeenCalledTimes(1);
    const corrective = generate.mock.calls[0][0];
    expect(corrective.prompt).toContain(
      'Void-Maw has no line of sight to The Seeker at 30ft; ranged attacks require line of ' +
        'sight; you have 30ft movement.',
    );
    expect(result.text).toBe(legal);
    expect(warnings[0]).toMatchObject({
      msg: 'DM_COMBAT_CONTRACT_CORRECTIVE_REPROMPT',
      contract: 'spatial',
      kind: 'ranged_without_line_of_sight',
      distanceFeet: 30,
    });
    expect(errors).toHaveLength(0);
  });

  test('a second violation is logged loudly and passed through rather than looping', async () => {
    generate.mockImplementation(async () => ({ text: illegal, provider: 'openrouter' as const }));
    const result = await enforce(illegal);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(illegal);
    expect(errors[0]).toMatchObject({
      msg: '!!!!!!!!!!!!!!!! DM_COMBAT_CONTRACT_VIOLATION_PASSTHROUGH !!!!!!!!!!!!!!!!',
      contract: 'spatial',
      alert: true,
    });
  });

  test('a spatially coherent move-and-attack turn is left alone', async () => {
    const result = await enforce(legal);
    expect(generate).not.toHaveBeenCalled();
    expect(result.text).toBe(legal);
  });
});
