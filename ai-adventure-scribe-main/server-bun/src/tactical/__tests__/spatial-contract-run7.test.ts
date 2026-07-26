import { describe, expect, test } from 'bun:test';

import { resolvePairFromText } from '../attack-pair.js';
import { parseTacticalDigest } from '../digest-parse.js';
import { assignEntitySlugs } from '../identity.js';
import { translateLegacyAttackRolls } from '../legacy-attack-translation.js';
import { buildTacticalPrompt } from '../prompt.js';
import { validateSpatialCombatContract } from '../spatial-contract.js';

import type { DMResponse } from '../../services/dm/dm-response-schema.js';
import type { MapEntity, TacticalMap } from '../types.js';

/**
 * Run 7 reproduction. Slugs resolved, the whole board reached the digest, and not one identity
 * was rejected - yet the DM emitted zero moves across thirty turns while narrating melee at
 * 20-30ft, and the spatial contract stayed silent through all of it.
 *
 * The cause was not the ambiguity refusal it looked like. `resolvePairFromText` demanded that a
 * roll request's purpose name BOTH sides of the attack, and real purposes name one: a player's
 * "attack roll against the Shadow Roach" has no attacker in it, and a monster's "the Shadow
 * Roach lunges at you" has no victim. One name meant no pair, no pair meant no check, and no
 * check meant silence. Each shape below returned null before the fix.
 */
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

/** Three roaches, all sharing one display name, at the 20-30ft the DM narrated melee across. */
const board = (): TacticalMap => {
  const entities = [
    entity('pc-uuid', 'The Seeker', 1, 1, 'pc'),
    entity('roach-a', 'Shadow Roach', 6, 5, 'monster'),
    entity('roach-b', 'Shadow Roach', 7, 6, 'monster'),
    entity('roach-c', 'Shadow Roach', 5, 7, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: 'session',
    width: 16,
    height: 14,
    round: 1,
    sceneDescription: 'test',
    cells: Array.from({ length: 14 }, () =>
      Array.from({ length: 16 }, () => ({
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

const turnPrompt = (activeSlug: string): string =>
  `<tactical_context>\n${buildTacticalPrompt(board(), activeSlug)}\n</tactical_context>\n` +
  '<immutable_game_state>{"isInCombat":true}</immutable_game_state>';

const response = (overrides: Partial<DMResponse> = {}): DMResponse => ({
  text: 'The Shadow Roach lunges.',
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
  ac: 15,
  advantage: false,
  disadvantage: false,
});

describe('run 7: purposes that name only one side of the attack', () => {
  test('the digest carries whose turn it is, so a missing attacker can be inferred', () => {
    const digest = parseTacticalDigest(turnPrompt('shadow-roach-1'))!;
    expect(digest.activeId).toBe('shadow-roach-1');
    expect([...digest.entities.keys()].sort()).toEqual([
      'shadow-roach-1',
      'shadow-roach-2',
      'shadow-roach-3',
      'the-seeker',
    ]);
  });

  test('a shared display name stays ambiguous instead of silently picking the last roach', () => {
    const digest = parseTacticalDigest(turnPrompt('shadow-roach-1'))!;
    expect(digest.aliases.has('shadow roach')).toBe(false);
    expect(digest.ambiguousAliases.get('shadow roach')).toEqual([
      'shadow-roach-1',
      'shadow-roach-2',
      'shadow-roach-3',
    ]);
  });

  test.each([
    ['Attack roll against the Shadow Roach', 'the-seeker', 'shadow-roach-1'],
    ['Your attack roll against the Shadow Roach', 'the-seeker', 'shadow-roach-1'],
    ['Attack roll vs shadow-roach-2', 'the-seeker', 'shadow-roach-2'],
  ])(
    'a player attack purpose naming only the target fires: %p',
    (purpose, expectedActor, expectedTarget) => {
      // The Seeker is acting; the purpose never says so, and before the fix that was fatal.
      const prompt = turnPrompt('the-seeker');
      const pair = resolvePairFromText(parseTacticalDigest(prompt)!, purpose)!;
      expect(pair.actor.id).toBe(expectedActor);
      expect(pair.target.id).toBe(expectedTarget);
      expect(pair.fallbacks).toContain('assumed_actor');
      expect(
        validateSpatialCombatContract(
          response({ roll_requests: [attackRequest(purpose)] }),
          prompt,
          true,
        ),
      ).toMatchObject({
        kind: 'melee_out_of_reach',
        actorId: expectedActor,
        targetId: expectedTarget,
      });
    },
  );

  test.each([
    ['The Shadow Roach lunges at you', 'shadow-roach-1'],
    ['the Shadow Roach bites', 'shadow-roach-1'],
  ])('a monster attack purpose naming only itself fires: %p', (purpose, activeSlug) => {
    const prompt = turnPrompt(activeSlug);
    const pair = resolvePairFromText(parseTacticalDigest(prompt)!, purpose)!;
    expect(pair.actor.id).toBe(activeSlug);
    expect(pair.target.id).toBe('the-seeker');
    expect(pair.fallbacks).toContain('assumed_target');
    expect(
      validateSpatialCombatContract(
        response({ roll_requests: [attackRequest(purpose)] }),
        prompt,
        true,
      ),
    ).toMatchObject({ kind: 'melee_out_of_reach', targetId: 'the-seeker' });
  });

  test('an ambiguous target resolves to the nearest matching hostile, not an arbitrary one', () => {
    // shadow-roach-1 is 25ft from The Seeker; the other two are 30ft. Last-write-wins on the
    // shared name used to hand this to shadow-roach-3 purely because it was parsed last.
    const prompt = turnPrompt('the-seeker');
    const pair = resolvePairFromText(
      parseTacticalDigest(prompt)!,
      'The Seeker swings at the Shadow Roach',
    )!;
    expect(pair.target.id).toBe('shadow-roach-1');
    expect(pair.fallbacks).toContain('nearest_hostile');
  });

  test('an explicit two-sided purpose still resolves with no fallback at all', () => {
    const pair = resolvePairFromText(
      parseTacticalDigest(turnPrompt('shadow-roach-2'))!,
      'shadow-roach-2 bites the-seeker',
    )!;
    expect([pair.actor.id, pair.target.id]).toEqual(['shadow-roach-2', 'the-seeker']);
    expect(pair.fallbacks).toEqual([]);
  });

  test('a purpose naming nobody on the board still resolves to nothing', () => {
    expect(
      resolvePairFromText(parseTacticalDigest(turnPrompt('the-seeker'))!, 'a wisdom saving throw'),
    ).toBeNull();
  });
});

/**
 * Run 7 steered attacks into `combat_actions` with a corrective. Run 8 proved a corrective
 * cannot do that job — eleven of them, zero adoption — so the steering became translation.
 * The behaviour that mattered is unchanged and still pinned here: an attack written the old
 * way ends up in `combat_actions`, and saves and checks are left exactly where they were.
 */
describe('run 7, settled by run 8: attacks end up in combat_actions either way', () => {
  test('an attack roll_request during active combat is translated, not refused', () => {
    const prompt = turnPrompt('the-seeker');
    const result = translateLegacyAttackRolls(
      response({ roll_requests: [attackRequest('Attack roll against the Shadow Roach')] }),
      prompt,
      true,
    )!;
    expect(result.response.roll_requests).toHaveLength(0);
    expect(result.response.combat_actions[0]).toMatchObject({
      actor_id: 'the-seeker',
      action_type: 'attack',
    });
  });

  test('saves and checks during combat are left alone', () => {
    expect(
      translateLegacyAttackRolls(
        response({
          roll_requests: [
            { ...attackRequest('Dexterity save vs the collapsing floor'), type: 'save', dc: 14 },
          ],
        }),
        turnPrompt('the-seeker'),
        true,
      ),
    ).toBeNull();
  });

  test('outside combat nothing is translated', () => {
    expect(
      translateLegacyAttackRolls(
        response({ roll_requests: [attackRequest('Attack roll against the bandit')] }),
        turnPrompt('the-seeker'),
        false,
      ),
    ).toBeNull();
  });
});
