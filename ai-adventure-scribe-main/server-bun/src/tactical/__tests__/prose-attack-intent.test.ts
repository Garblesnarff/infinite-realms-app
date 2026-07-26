import { describe, expect, test } from 'bun:test';

import { assignEntitySlugs } from '../identity.js';
import { buildTacticalPrompt } from '../prompt.js';
import { hasAttackLanguage, inferProseAttackIntent } from '../prose-attack-intent.js';

import type { DMResponse } from '../../services/dm/dm-response-schema.js';
import type { MapEntity, TacticalMap } from '../types.js';

/**
 * Run 9 reproduction.
 *
 * Thirty turns, zero attack `roll_requests`, zero `combat_actions`, twenty-three attacks
 * narrated in pure prose, and a board that never moved. The paragraph below is the mid-combat
 * envelope captured from that run, verbatim, and it is the pinned case: this exact text must
 * produce an engine-resolved attack, because on the day it was written it produced nothing.
 *
 * Note what it does NOT contain — no attack verb at all. "Drawing your blade" is the only
 * evidence a strike is happening, which is why the weapon vocabulary is load-bearing.
 */
const RUN_9_SEQ_12 =
  'You surge forward through the damp air, drawing your blade to meet the chitinous threat ' +
  'head-on. The nearest Shadow Roach 1 skitters across the flagstones toward you, mandibles ' +
  'clicking in the dark.';

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
    entity('shadow-roach-1', 'Shadow Roach 1', 6, 5, 'monster'),
    entity('shadow-roach-2', 'Shadow Roach 2', 10, 9, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 14,
    height: 12,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 12 }, () =>
      Array.from({ length: 14 }, () => ({
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

const promptFor = (activeId: string): string =>
  `<tactical_context>\n${buildTacticalPrompt(board(), activeId)}\n</tactical_context>\n` +
  '<immutable_game_state>{"isInCombat":true,"encounterId":"enc-9"}</immutable_game_state>';

const response = (overrides: Partial<DMResponse> = {}): DMResponse => ({
  text: RUN_9_SEQ_12,
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

const attackRequest = (purpose: string) => ({
  type: 'attack' as const,
  formula: '1d20+4',
  purpose,
  dc: null,
  ac: null,
  advantage: false,
  disadvantage: false,
});

const attackAction = (actorId: string, targetId: string) => ({
  actor_id: actorId,
  action_type: 'attack' as const,
  target_ids: [targetId],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
});

describe("run 9's prose becomes an attack the engine can execute", () => {
  test('the pinned seq-12 paragraph synthesizes a combat_action', () => {
    const inference = inferProseAttackIntent(response(), promptFor('the-seeker'), true);
    expect(inference).not.toBeNull();
    expect(inference!.action).toEqual({
      actor_id: 'the-seeker',
      action_type: 'attack',
      target_ids: ['shadow-roach-1'],
      weapon_id: 'blade',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    });
  });

  test('the actor is whose turn it is, never whoever the prose names first', () => {
    // The same paragraph on a roach's turn is the roach acting, not The Seeker.
    const inference = inferProseAttackIntent(
      response({ text: 'Shadow Roach 1 lunges at The Seeker, mandibles snapping.' }),
      promptFor('shadow-roach-1'),
      true,
    );
    expect(inference!.actorId).toBe('shadow-roach-1');
    expect(inference!.targetId).toBe('the-seeker');
  });

  test('an ally named in the prose is never the target: only hostiles are eligible', () => {
    const inference = inferProseAttackIntent(
      response({
        text: 'Shadow Roach 2 chitters at Shadow Roach 1 and they both scuttle forward, mandibles wide.',
      }),
      promptFor('shadow-roach-1'),
      true,
    );
    // Neither roach is a hostile of the other, so there is nothing to strike at.
    expect(inference).toBeNull();
  });

  test('narration naming nobody on the board infers nothing', () => {
    const inference = inferProseAttackIntent(
      response({ text: 'You raise your blade against the darkness itself.' }),
      promptFor('the-seeker'),
      true,
    );
    expect(inference).toBeNull();
  });
});

describe('the floor stays out of the way of every dialect above it', () => {
  test('a declared combat_action is not doubled by an inference', () => {
    const inference = inferProseAttackIntent(
      response({ combat_actions: [attackAction('the-seeker', 'shadow-roach-1')] }),
      promptFor('the-seeker'),
      true,
    );
    expect(inference).toBeNull();
  });

  test('an attack roll_request is not doubled by an inference', () => {
    const inference = inferProseAttackIntent(
      response({ roll_requests: [attackRequest('the-seeker attacks shadow-roach-1')] }),
      promptFor('the-seeker'),
      true,
    );
    expect(inference).toBeNull();
  });

  test('a turn that is only a save still infers the attack the prose describes', () => {
    const inference = inferProseAttackIntent(
      response({
        roll_requests: [
          {
            type: 'save' as const,
            formula: '1d20+2',
            purpose: 'Dexterity save vs the collapsing floor',
            dc: 14,
            ac: null,
            advantage: false,
            disadvantage: false,
          },
        ],
      }),
      promptFor('the-seeker'),
      true,
    );
    expect(inference!.targetId).toBe('shadow-roach-1');
  });

  test('outside combat nothing is inferred, whatever the prose says', () => {
    expect(inferProseAttackIntent(response(), promptFor('the-seeker'), false)).toBeNull();
  });

  test('without a tactical digest there is no geometry and no inference', () => {
    expect(
      inferProseAttackIntent(
        response(),
        '<immutable_game_state>{"isInCombat":true}</immutable_game_state>',
        true,
      ),
    ).toBeNull();
  });
});

describe('attack language', () => {
  test.each([
    ['the run 9 paragraph, which carries a weapon and no verb', RUN_9_SEQ_12],
    ['a verb with no weapon', 'The roach lunges at you across the flagstones.'],
    ['a natural weapon', 'Its mandibles close on your forearm.'],
  ])('%s reads as an attack', (_name, text) => {
    expect(hasAttackLanguage(text)).toBe(true);
  });

  test.each([
    ['pure scene-setting', 'The chamber is silent. Water drips from the vaulted ceiling.'],
    ['a withheld strike', 'You hold your blade and wait for it to move first.'],
    ['dialogue', '"Stay back," you tell the trembling scribe behind you.'],
  ])('%s does not', (_name, text) => {
    expect(hasAttackLanguage(text)).toBe(false);
  });
});
