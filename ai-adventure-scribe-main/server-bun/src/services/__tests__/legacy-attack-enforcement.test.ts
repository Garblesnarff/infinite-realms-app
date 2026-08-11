import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { resetEncounterHints } from '../../tactical/encounter-hints.js';
import { assignEntitySlugs } from '../../tactical/identity.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';
import { enforceCombatTransitionContract } from '../combat-transition-enforcement.js';
import { LLMProviderService } from '../llm-provider-service.js';

import type { MapEntity, TacticalMap } from '../../tactical/types.js';
import type { DMResponse } from '../dm/dm-response-schema.js';

const infos: Array<Record<string, unknown>> = [];

const generate = spyOn(LLMProviderService, 'generate');
const info = spyOn(logger, 'info').mockImplementation(((entry: Record<string, unknown>) => {
  infos.push(entry);
}) as typeof logger.info);

const entity = (id: string, name: string, x: number, y: number, type: 'pc' | 'monster') =>
  ({
    id,
    name,
    x,
    y,
    size: 'medium',
    type,
    speedFeet: 30,
    movementRemaining: 30,
  }) satisfies MapEntity;

const board = (): TacticalMap => {
  const entities = [
    entity('the-seeker', 'The Seeker', 1, 1, 'pc'),
    entity('shadow-roach', 'Shadow Roach', 6, 5, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 12,
    height: 10,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 10 }, () =>
      Array.from({ length: 12 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as const,
        elevation: 0,
      })),
    ),
    entities,
  };
};

const promptFor = (encounterId: string): string =>
  `<tactical_context>\n${buildTacticalPrompt(board(), 'the-seeker')}\n</tactical_context>\n` +
  `<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>`;

const dmResponse = (overrides: Partial<DMResponse>): string =>
  JSON.stringify({
    text: 'The Seeker swings.',
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

const legacyAttack = dmResponse({
  roll_requests: [
    {
      type: 'attack',
      formula: '1d20+5',
      purpose: 'Attack roll with longsword against Shadow Roach',
      dc: null,
      ac: 15,
      advantage: false,
      disadvantage: false,
    },
  ],
});

const enforce = (text: string, encounterId: string) =>
  enforceCombatTransitionContract({
    result: { text, provider: 'openrouter' },
    prompt: promptFor(encounterId),
    maxTokens: 4000,
    temperature: 0.9,
    provider: 'openrouter',
    responseSchema: { properties: { combat_transition: {}, roll_requests: {} } },
  });

beforeEach(() => {
  generate.mockClear();
  generate.mockImplementation(async () => ({
    text: legacyAttack,
    provider: 'openrouter' as const,
  }));
  infos.length = 0;
  resetEncounterHints();
});

afterAll(() => {
  generate.mockRestore();
  info.mockRestore();
});

describe('legacy attack rolls are accepted, and taught once', () => {
  test('the first offence in an encounter fires exactly one teaching hint with live slugs', async () => {
    await enforce(legacyAttack, 'enc-first');

    expect(generate).toHaveBeenCalledTimes(1);
    const hint = generate.mock.calls[0][0].prompt;
    expect(hint).toContain('"actor_id":"the-seeker"');
    expect(hint).toContain('"target_ids":["shadow-roach"]');
    expect(hint).toContain('combat_actions');
  });

  test('every later offence in the same encounter is translated silently', async () => {
    await enforce(legacyAttack, 'enc-repeat');
    generate.mockClear();

    for (let turn = 0; turn < 5; turn += 1) await enforce(legacyAttack, 'enc-repeat');
    expect(generate).not.toHaveBeenCalled();
  });

  test('a new encounter is taught again, once', async () => {
    await enforce(legacyAttack, 'enc-a');
    generate.mockClear();
    await enforce(legacyAttack, 'enc-b');
    expect(generate).toHaveBeenCalledTimes(1);
    generate.mockClear();
    await enforce(legacyAttack, 'enc-b');
    expect(generate).not.toHaveBeenCalled();
  });

  test('the response handed back always carries the synthesized combat_action', async () => {
    await enforce(legacyAttack, 'enc-shape');
    // Second turn: no hint, so what comes back is the silently translated response itself.
    const result = await enforce(legacyAttack, 'enc-shape');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.roll_requests).toHaveLength(0);
    expect(parsed.combat_actions).toEqual([
      {
        actor_id: 'the-seeker',
        action_type: 'attack',
        target_ids: ['shadow-roach'],
        weapon_id: 'longsword',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
    ]);
    expect(infos.some((entry) => entry.msg === 'DM_LEGACY_ATTACK_TRANSLATED')).toBe(true);
  });

  test('a hint the model answers in the old dialect again is translated, not corrected again', async () => {
    const result = await enforce(legacyAttack, 'enc-stubborn');
    expect(generate).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.roll_requests).toHaveLength(0);
    expect(parsed.combat_actions).toHaveLength(1);
  });

  test('a failed hint re-prompt still returns the translated response, never the raw one', async () => {
    generate.mockImplementation(async () => ({
      text: '',
      provider: 'openrouter' as const,
      error: 'upstream exploded',
    }));
    const result = await enforce(legacyAttack, 'enc-broken');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.combat_actions).toHaveLength(1);
    expect(parsed.roll_requests).toHaveLength(0);
  });
});
