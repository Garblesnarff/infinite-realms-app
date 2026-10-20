import { describe, expect, it } from 'bun:test';

import { resolveCombatIntentRefs } from '../combat-intent-refs.js';

/**
 * #876 (Hark N2-012): two avatars seated under the DM's label "The Pale Shape N" while
 * their result cards read "The Thing Below (Avatar) N" — the bestiary heading stored on
 * the attack profile at seating (#2398). The player cast Sacred Flame at the name on the
 * card and was refused: "Who do you mean: The Pale Shape 1, The Pale Shape 2?". A target
 * reference must resolve by either name; the unnumbered heading names both seats and
 * stays unresolved. Rows are shaped like `getCombatState` participants (the display name
 * rides on `monsterAttack`, there is no column for it).
 */
const PLAYER = {
  id: '465816e1-0000-4000-8000-000000000001',
  name: 'Rook',
  participantType: 'player',
};
const AVATAR_ONE = {
  id: '779792b2-0000-4000-8000-000000000002',
  name: 'The Pale Shape 1',
  participantType: 'monster',
  monsterAttack: { displayName: 'The Thing Below (Avatar) 1' },
};
const AVATAR_TWO = {
  id: '779792b2-0000-4000-8000-000000000003',
  name: 'The Pale Shape 2',
  participantType: 'monster',
  monsterAttack: { displayName: 'The Thing Below (Avatar) 2' },
};

type Row = {
  id: string;
  name: string;
  participantType: string;
  monsterAttack?: unknown;
  displayName?: string;
};

const state = (
  participants: Row[],
): { encounter: { id: string; sessionId: string }; participants: Row[] } => ({
  encounter: { id: 'enc', sessionId: 'session' },
  participants,
});
/** A board that resolves nothing, so only the encounter roster can answer. */
const emptyBoard = { resolve: (token: string): string => token, roster: (): string => 'rook@1,1' };

const castAt = (
  target: string,
): { type: string; actorId: string; targetIds: string[] } => ({
  type: 'spell',
  actorId: 'rook',
  targetIds: [target],
});

describe('a target named by its result-card name (#876)', () => {
  it('resolves the display name the player read on the card', () => {
    const resolved = resolveCombatIntentRefs(
      castAt('The Thing Below (Avatar) 1'),
      emptyBoard,
      state([PLAYER, AVATAR_ONE, AVATAR_TWO]),
    );

    expect(resolved.targetIds).toEqual([AVATAR_ONE.id]);
  });

  it('resolves the slug spelling of the display name', () => {
    const resolved = resolveCombatIntentRefs(
      castAt('the-thing-below-avatar-2'),
      emptyBoard,
      state([PLAYER, AVATAR_ONE, AVATAR_TWO]),
    );

    expect(resolved.targetIds).toEqual([AVATAR_TWO.id]);
  });

  it('still resolves the seating label', () => {
    const resolved = resolveCombatIntentRefs(
      castAt('The Pale Shape 2'),
      emptyBoard,
      state([PLAYER, AVATAR_ONE, AVATAR_TWO]),
    );

    expect(resolved.targetIds).toEqual([AVATAR_TWO.id]);
  });

  it('stays unresolved when the unnumbered heading names two seats', () => {
    expect(() =>
      resolveCombatIntentRefs(
        castAt('The Thing Below (Avatar)'),
        emptyBoard,
        state([PLAYER, AVATAR_ONE, AVATAR_TWO]),
      ),
    ).toThrow('Combat participant not found');
  });

  it('resolves a display name carried directly on the row', () => {
    const direct = { ...AVATAR_ONE, monsterAttack: undefined, displayName: 'The Thing Below (Avatar) 1' };
    const resolved = resolveCombatIntentRefs(
      castAt('The Thing Below (Avatar) 1'),
      emptyBoard,
      state([PLAYER, direct, AVATAR_TWO]),
    );

    expect(resolved.targetIds).toEqual([AVATAR_ONE.id]);
  });
});

describe('a catalog ref for a renamed creature (#876)', () => {
  it('resolves through the bestiary heading when one seat carries it', () => {
    const resolved = resolveCombatIntentRefs(
      castAt('campaign:the-thing-below-avatar'),
      emptyBoard,
      state([PLAYER, AVATAR_ONE]),
    );

    expect(resolved.targetIds).toEqual([AVATAR_ONE.id]);
  });

  it('stays unresolved when two seats carry the heading', () => {
    expect(() =>
      resolveCombatIntentRefs(
        castAt('campaign:the-thing-below-avatar'),
        emptyBoard,
        state([PLAYER, AVATAR_ONE, AVATAR_TWO]),
      ),
    ).toThrow('Combat participant not found');
  });

  it('resolves a numbered seat by its unnumbered stat-block key', () => {
    const roach = {
      id: '779792b2-0000-4000-8000-000000000004',
      name: 'Shadow Roach 2',
      participantType: 'monster',
    };

    const resolved = resolveCombatIntentRefs(
      castAt('srd:shadow-roach'),
      emptyBoard,
      state([PLAYER, roach]),
    );

    expect(resolved.targetIds).toEqual([roach.id]);
  });
});
