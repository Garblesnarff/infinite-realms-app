import { describe, expect, it } from 'bun:test';

import { resolveCombatIntentRefs } from '../combat-intent-refs.js';

/**
 * Run 13 (#2303): the DM addressed the spider by its stat-block key, `srd:vitruvian-spider`,
 * while the board had seated it as `the-vitruvian-spider`. The board index and the roster alias
 * both missed, and the player's Chill Touch came back 404 "Combat participant not found".
 */
const SCHOLAR = {
  id: '465816e1-0000-4000-8000-000000000001',
  name: 'The Scholar',
  participantType: 'player',
};
const SPIDER = {
  id: '779792b2-0000-4000-8000-000000000002',
  name: 'The Vitruvian Spider',
  participantType: 'monster',
};

const state = (participants: Array<{ id: string; name: string; participantType: string }>) => ({
  encounter: { id: 'enc', sessionId: 'session' },
  participants,
});
/** A board that resolves nothing, so only the encounter roster can answer. */
const emptyBoard = { resolve: (token: string) => token, roster: () => 'the-scholar@1,1' };

const castAt = (target: string) => ({
  type: 'spell',
  actorId: 'the-scholar',
  targetIds: [target],
});

describe('an accented scene name as a combat target (#798)', () => {
  const PLAYER = {
    id: '465816e1-0000-4000-8000-000000000001',
    name: 'Rook',
    participantType: 'player',
  };
  const FLAMBE = {
    id: 'e5f6a7b8-c9d0-4e12-8345-67a89bcd0123',
    name: 'House Flambé Student',
    participantType: 'monster',
  };

  const strikeAt = (target: string) => ({
    type: 'attack',
    actorId: PLAYER.id,
    targetId: target,
  });

  it('resolves the romanized slug the DM copied onto the accented seat', () => {
    const resolved = resolveCombatIntentRefs(
      strikeAt('house-flambe-student'),
      emptyBoard,
      state([PLAYER, FLAMBE]),
    );

    expect(resolved.targetId).toBe(FLAMBE.id);
  });

  it('resolves the numbered romanized slug onto the lone accented seat', () => {
    const resolved = resolveCombatIntentRefs(
      strikeAt('house-flambe-student-1'),
      emptyBoard,
      state([PLAYER, FLAMBE]),
    );

    expect(resolved.targetId).toBe(FLAMBE.id);
  });
});

describe('a catalog ref as a combat target', () => {
  it('resolves to the one participant seated from that stat block', () => {
    const warnings: Array<Record<string, unknown>> = [];

    const resolved = resolveCombatIntentRefs(
      castAt('srd:vitruvian-spider'),
      emptyBoard,
      state([SCHOLAR, SPIDER]),
      (data) => warnings.push(data),
    );

    expect(resolved.targetIds).toEqual([SPIDER.id]);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        msg: 'COMBAT_INTENT_REF_RECONCILED_FROM_CATALOG_REF',
        submittedRef: 'srd:vitruvian-spider',
        resolvedTo: SPIDER.id,
      }),
    );
  });

  it('accepts the same key however the DM spells the word break', () => {
    const resolved = resolveCombatIntentRefs(
      castAt('srd:vitruvian_spider'),
      emptyBoard,
      state([SCHOLAR, SPIDER]),
    );

    expect(resolved.targetIds).toEqual([SPIDER.id]);
  });

  it('stays unresolved when two participants answer to the key', () => {
    const second = {
      id: 'b0000000-0000-4000-8000-000000000003',
      name: 'Vitruvian Spider',
      participantType: 'npc',
    };

    expect(() =>
      resolveCombatIntentRefs(
        castAt('srd:vitruvian-spider'),
        emptyBoard,
        state([SCHOLAR, SPIDER, second]),
      ),
    ).toThrow('Combat participant not found');
  });

  it('stays unresolved when no participant was seated from that stat block', () => {
    expect(() =>
      resolveCombatIntentRefs(castAt('srd:stone-golem'), emptyBoard, state([SCHOLAR, SPIDER])),
    ).toThrow('Combat participant not found');
  });

  it('never lands on a player whose name collides with the key', () => {
    // A PC named after the creature: the DM's catalog key still means the stat block.
    const namesake = {
      id: 'c0000000-0000-4000-8000-000000000004',
      name: 'Vitruvian Spider',
      participantType: 'player',
    };

    const resolved = resolveCombatIntentRefs(
      castAt('srd:vitruvian-spider'),
      emptyBoard,
      state([SCHOLAR, namesake, SPIDER]),
    );

    expect(resolved.targetIds).toEqual([SPIDER.id]);
  });

  it('stays unresolved when the only name that matches is a player', () => {
    const namesake = {
      id: 'c0000000-0000-4000-8000-000000000004',
      name: 'Vitruvian Spider',
      participantType: 'player',
    };

    expect(() =>
      resolveCombatIntentRefs(
        castAt('srd:vitruvian-spider'),
        emptyBoard,
        state([SCHOLAR, namesake]),
      ),
    ).toThrow('Combat participant not found');
  });
});
