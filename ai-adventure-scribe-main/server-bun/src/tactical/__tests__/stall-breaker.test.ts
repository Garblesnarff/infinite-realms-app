import { describe, expect, test } from 'bun:test';

import { assignEntitySlugs } from '../identity.js';
import { buildStallDirective, shouldBreakStall, STALL_TURN_THRESHOLD } from '../stall-breaker.js';

import type { MapEntity, TacticalMap } from '../types.js';

const entity = (id: string, name: string, x: number, y: number, type: MapEntity['type']) =>
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
    entity('brazier', 'Brazier', 3, 3, 'object'),
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

/**
 * The threshold is the assertion, not an implementation detail. Two silent turns is a scene
 * with conversation in it; three is run 9's loop, where seq 12 and seq 20 were byte-identical
 * because nothing had ever come back to condition on.
 */
describe('the stall-breaker fires at exactly three silent turns', () => {
  test('one and two silent turns are not a stall', () => {
    expect(shouldBreakStall(0)).toBe(false);
    expect(shouldBreakStall(1)).toBe(false);
    expect(shouldBreakStall(2)).toBe(false);
  });

  test('the third fires, and it keeps firing while the silence lasts', () => {
    expect(STALL_TURN_THRESHOLD).toBe(3);
    expect(shouldBreakStall(3)).toBe(true);
    expect(shouldBreakStall(9)).toBe(true);
  });
});

describe('the directive carries live ids, not placeholders', () => {
  test('it names the active actor, a real hostile, and the exact expected shape', () => {
    const directive = buildStallDirective(board(), 'the-seeker', 3);
    expect(directive).toContain('resolved NOTHING for 3 consecutive turns');
    expect(directive).toContain('"type":"attack"');
    expect(directive).toContain('"purpose":"the-seeker attacks shadow-roach-1"');
    expect(directive).not.toContain('<actor_id>');
    expect(directive).not.toContain('unknown');
  });

  test('on a monster turn the monster is the actor and the pc is the target', () => {
    const directive = buildStallDirective(board(), 'shadow-roach-1', 4);
    expect(directive).toContain('"purpose":"shadow-roach-1 attacks the-seeker"');
  });

  test('the roster it offers to copy from excludes scenery', () => {
    const roster = /copying ids from this exact list: (.+)/.exec(
      buildStallDirective(board(), 'the-seeker', 3),
    )![1];
    expect(roster).toBe('the-seeker, shadow-roach-1');
  });

  test('it forbids exactly the two things run 9 did every turn', () => {
    const directive = buildStallDirective(board(), 'the-seeker', 5);
    expect(directive).toMatch(/Do not narrate a hit, a miss, or any damage number/);
    expect(directive).toMatch(/Do not repeat the paragraph you wrote last turn/);
  });
});
