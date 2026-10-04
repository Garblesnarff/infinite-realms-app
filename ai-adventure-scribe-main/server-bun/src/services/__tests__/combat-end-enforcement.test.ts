import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { resetEncounterHints } from '../../tactical/encounter-hints.js';
import { assignEntitySlugs } from '../../tactical/identity.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';
import { enforceCombatTransitionContract } from '../combat-transition-enforcement.js';
import { LLMProviderService } from '../llm-provider-service.js';

import type { MapEntity, TacticalMap } from '../../tactical/types.js';
import type { DMResponse } from '../dm/dm-response-schema.js';

/**
 * #2524, run D1: the envelope carried `combat_transition: 'end'` on the turn the
 * player declared an attack, and the end pre-empted the attack — no roll happened,
 * yet the DM narrated the kill ("collapses, lifeless" at 5/11 HP). Envelopes here
 * are built field-for-field as the real producer emits them (the same full shape
 * the prose-attack suite uses, `combat_transition` included — #2349).
 */
const generate = spyOn(LLMProviderService, 'generate');

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
    entity('the-veteran', 'The Veteran', 1, 1, 'pc'),
    entity('vitruvian-spider', 'Vitruvian Spider', 6, 5, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 12,
    height: 10,
    round: 3,
    sceneDescription: 'gallery',
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
  `<tactical_context>\n${buildTacticalPrompt(board(), 'the-veteran')}\n</tactical_context>\n` +
  `<turn_order round="3">\n` +
  `→ 1. the-veteran | The Veteran | 9/12 HP | action:available | CURRENT TURN | role:player\n` +
  `  2. vitruvian-spider | Vitruvian Spider | 5/11 HP | action:available | role:hostile\n` +
  `</turn_order>\n` +
  `<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>`;

const dmResponse = (overrides: Partial<DMResponse>): string =>
  JSON.stringify({
    text: 'You ready your longsword.',
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

const enforce = (text: string, encounterId: string) =>
  enforceCombatTransitionContract({
    result: { text, provider: 'openrouter' },
    prompt: promptFor(encounterId),
    maxTokens: 4000,
    temperature: 0.9,
    provider: 'openrouter',
    responseSchema: { properties: { combat_transition: {}, roll_requests: {} } },
  });

const declaredAttack: DMResponse['combat_actions'][number] = {
  actor_id: 'the-veteran',
  action_type: 'attack',
  target_ids: ['vitruvian-spider'],
  weapon_id: 'longsword',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

beforeEach(() => {
  generate.mockClear();
  generate.mockImplementation(async () => ({ text: '', provider: 'openrouter' as const }));
  resetEncounterHints();
});

afterAll(() => {
  generate.mockRestore();
});

describe('declared actions resolve before the end transition (#2524)', () => {
  test('zero declared actions with a live hostile at 5/11 also defers the end', async () => {
    const envelope = dmResponse({ combat_transition: 'end', combat_actions: [] });
    const result = await enforce(envelope, 'enc-d1-zero-action');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.combat_transition).toBe('none');
    expect(generate).not.toHaveBeenCalled();
  });

  test('a declared fled exit may end the fight, but lifeless prose about it is still rejected', async () => {
    generate.mockImplementation(async () => ({
      text: dmResponse({
        text: 'The Vitruvian Spider flees into the dark, gone from the fight.',
        combat_transition: 'end',
        combat_exits: [{ participant_id: 'vitruvian-spider', exit: 'fled' }],
      }),
      provider: 'openrouter' as const,
    }));
    const envelope = dmResponse({
      text: 'The Vitruvian Spider collapses, lifeless, upon the pulsing floor of the gallery.',
      combat_transition: 'end',
      combat_exits: [{ participant_id: 'vitruvian-spider', exit: 'fled' }],
    });
    const result = await enforce(envelope, 'enc-d1-fled-not-dead');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(parsed.text).not.toContain('lifeless');
    expect(parsed.combat_transition).toBe('end');
  });
  test('an envelope with an attack and combat_transition end keeps the attack and defers the end', async () => {
    const envelope = dmResponse({
      combat_transition: 'end',
      combat_actions: [declaredAttack],
    });
    const result = await enforce(envelope, 'enc-d1-actions-first');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.combat_transition).toBe('none');
    expect(parsed.combat_actions).toHaveLength(1);
    expect(generate).not.toHaveBeenCalled();
  });

  test('kill narration at 5/11 spends the one corrective reprompt and returns the rewrite', async () => {
    generate.mockImplementation(async () => ({
      text: dmResponse({
        text: 'The Vitruvian Spider reels back, wounded but still standing.',
        combat_transition: 'none',
      }),
      provider: 'openrouter' as const,
    }));
    const killing = dmResponse({
      text: 'The Vitruvian Spider collapses, lifeless, upon the pulsing floor of the gallery.',
      combat_transition: 'end',
    });
    const result = await enforce(killing, 'enc-d1-kill-rewrite');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(parsed.text).not.toContain('lifeless');
    expect(parsed.text).toContain('still standing');
  });

  test('a retry that still narrates the kill is stripped and the end is withdrawn', async () => {
    generate.mockImplementation(async () => ({
      text: dmResponse({
        text: 'The Vitruvian Spider collapses, lifeless, upon the pulsing floor of the gallery.',
        combat_transition: 'end',
      }),
      provider: 'openrouter' as const,
    }));
    const killing = dmResponse({
      text: 'The Vitruvian Spider collapses, lifeless, upon the pulsing floor of the gallery. The path ahead lies open.',
      combat_transition: 'end',
    });
    const result = await enforce(killing, 'enc-d1-kill-strip');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.text).not.toContain('lifeless');
    expect(parsed.combat_transition).toBe('none');
  });
});

describe('run D5 round 2: the narrated kill and the end arrive together (#2563)', () => {
  // The roster the D5 generate was judged against: the Scholar's turn, round 2,
  // Light-Eater Swarm 1 alive at 4/4, Swarm 2 already down at 0/4. No tactical board
  // is needed: the kill guard reads the turn-order block, and hit points live there.
  const d5Prompt = (encounterId: string): string =>
    `<turn_order round="2">\n` +
    `→ 1. the-scholar | The Scholar | 5/7 HP | action:available | CURRENT TURN\n` +
    `  2. light-eater-swarm-1 | Light-Eater Swarm 1 | 4/4 HP | action:available\n` +
    `  3. light-eater-swarm-2 | Light-Eater Swarm 2 | 0/4 HP | action:available\n` +
    `</turn_order>\n` +
    `<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>`;

  const d5Enforce = (text: string, encounterId: string) =>
    enforceCombatTransitionContract({
      result: { text, provider: 'openrouter' },
      prompt: d5Prompt(encounterId),
      maxTokens: 4000,
      temperature: 0.9,
      provider: 'openrouter',
      responseSchema: { properties: { combat_transition: {}, roll_requests: {} } },
    });

  // The verbatim DM kill narration from run D5 (#2561 §4).
  const D5_KILL =
    'Your quarterstaff strikes true, catching the fluttering, shadow-cloaked mass of ' +
    'the first Light-Eater as it attempts to reform after its last strike. The creature ' +
    'lets out a final, high-pitched harmonic shriek—a sound like a dying bell—that ' +
    'echoes off the obsidian walls before it dissipates into a cloud of dark, oily ash.';

  const d5Envelope = (overrides: Partial<DMResponse>): string =>
    dmResponse({
      text: D5_KILL,
      combat_transition: 'end',
      combat_actions: [
        {
          actor_id: 'the-scholar',
          action_type: 'attack',
          target_ids: ['light-eater-swarm-1'],
          weapon_id: 'quarterstaff',
          spell_id: null,
          slot_level: null,
          movement_feet: 0,
        },
      ],
      ...overrides,
    });

  test('the D5 envelope defers the end and the kill narration spends the corrective reprompt', async () => {
    generate.mockImplementation(async () => ({
      text: dmResponse({
        text: 'Your quarterstaff cracks against the fluttering mass, but the creature still hovers, shrieking.',
        combat_transition: 'none',
      }),
      provider: 'openrouter' as const,
    }));
    const result = await d5Enforce(d5Envelope({}), 'enc-d5-reprompt');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(generate).toHaveBeenCalledTimes(1);
    expect(parsed.text).not.toContain('dissipates');
    expect(parsed.text).toContain('still hovers');
    expect(parsed.combat_transition).toBe('none');
  });

  test('an unparseable retry falls back to the accepted response with the kill stripped', async () => {
    generate.mockImplementation(async () => ({
      text: 'the model answered in plain prose, not json',
      provider: 'openrouter' as const,
    }));
    const result = await d5Enforce(d5Envelope({}), 'enc-d5-unparseable-retry');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.text).not.toContain('dissipates');
    expect(parsed.combat_transition).toBe('none');
    // The declared attack survives the fallback: the already-translated response is
    // what goes back, never the raw one.
    expect(parsed.combat_actions).toHaveLength(1);
  });

  test('a failed correction also strips the kill instead of passing it through', async () => {
    generate.mockImplementation(async () => ({
      text: '',
      error: 'provider unavailable',
      provider: 'openrouter' as const,
    }));
    const result = await d5Enforce(d5Envelope({}), 'enc-d5-failed-correction');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.text).not.toContain('dissipates');
    expect(parsed.combat_transition).toBe('none');
  });

  test('narration_segments carrying the D5 kill are stripped even when text is clean', async () => {
    const envelope = d5Envelope({
      text: 'The obsidian walls echo with the swarm\u2019s shrieking.',
      combat_transition: 'none',
      combat_actions: [],
      narration_segments: [
        { type: 'dm', text: D5_KILL, character: null, voice_category: null },
      ],
    });
    const result = await d5Enforce(envelope, 'enc-d5-segments');
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(generate).not.toHaveBeenCalled();
    expect(parsed.text).toContain('echo with the swarm');
    expect(parsed.narration_segments[0].text).not.toContain('dissipates');
  });
});

describe('the generation-time roster knows roles, and a deferral tells the DM (#2563 review)', () => {
  const promptWithRoster = (encounterId: string, lines: string[]): string =>
    `<tactical_context>\n${buildTacticalPrompt(board(), 'the-veteran')}\n</tactical_context>\n` +
    `<turn_order round="3">\n${lines.join('\n')}\n</turn_order>\n` +
    `<immutable_game_state>{"isInCombat":true,"encounterId":"${encounterId}"}</immutable_game_state>`;

  const enforceWith = (text: string, prompt: string, facts?: string[]) =>
    enforceCombatTransitionContract({
      result: { text, provider: 'openrouter' },
      prompt,
      maxTokens: 4000,
      temperature: 0.9,
      provider: 'openrouter',
      responseSchema: { properties: { combat_transition: {}, roll_requests: {} } },
      recordTacticalFact: facts
        ? async (fact) => {
            facts.push(fact);
          }
        : undefined,
    });

  test('a standing ally does not block the end once every hostile is down', async () => {
    const facts: string[] = [];
    const prompt = promptWithRoster('enc-ally-standing', [
      '→ 1. the-veteran | The Veteran | 9/12 HP | action:available | CURRENT TURN | role:player',
      '  2. mira-thane | Mira Thane | 7/9 HP | action:available | role:ally',
      '  3. vitruvian-spider | Vitruvian Spider | 0/11 HP | action:available | role:hostile',
    ]);
    const result = await enforceWith(
      dmResponse({ combat_transition: 'end', combat_actions: [] }),
      prompt,
      facts,
    );
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.combat_transition).toBe('end');
    expect(facts).toEqual([]);
  });

  test('the player off-turn does not block the end once every hostile is down', async () => {
    const prompt = promptWithRoster('enc-player-off-turn', [
      '→ 1. vitruvian-spider | Vitruvian Spider | 0/11 HP | action:available | CURRENT TURN | role:hostile',
      '  2. the-veteran | The Veteran | 9/12 HP | action:available | role:player',
    ]);
    const result = await enforceWith(
      dmResponse({ combat_transition: 'end', combat_actions: [] }),
      prompt,
    );
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.combat_transition).toBe('end');
  });

  test('a deferred end writes the refusal fact for the DM next read', async () => {
    const facts: string[] = [];
    const result = await enforceWith(
      dmResponse({ combat_transition: 'end', combat_actions: [] }),
      promptFor('enc-defer-fact'),
      facts,
    );
    const parsed = JSON.parse(result.text) as DMResponse;
    expect(parsed.combat_transition).toBe('none');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toContain('COMBAT HAS NOT ENDED');
    expect(facts[0]).toContain('Vitruvian Spider');
  });
});
