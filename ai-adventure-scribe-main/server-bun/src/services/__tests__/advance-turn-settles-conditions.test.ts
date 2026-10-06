import { beforeEach, describe, expect, mock, test } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

/**
 * `advanceTurn` is the one boundary every turn change crosses (the player's end-turn, an NPC's,
 * and the death-save skip), so the conditions a check applied have to be settled from inside it.
 */
const participants = [
  { id: 'player', turnOrder: 0, isActive: true },
  { id: 'goblin', turnOrder: 1, isActive: true },
];
let encounter = {
  id: 'encounter-1',
  sessionId: 'session-1',
  status: 'active',
  currentTurnOrder: 0,
  currentRound: 1,
};
const settled: unknown[] = [];

mock.module('../../../../db/client', () => ({
  db: {
    query: {
      combatEncounters: { findFirst: async () => ({ ...encounter, participants }) },
    },
    update: () => ({ set: () => ({ where: async () => [] }) }),
  },
}));
mock.module('../combat/combat-turn-resources.js', () => ({ resetTurnResources: async () => {} }));
mock.module('../combat/combat-check-conditions.js', () => ({
  settleCheckConditionsForTurn: async (params: unknown) => {
    settled.push(params);
  },
}));

const { CombatInitiativeService } = await import('../combat-initiative-service.js');

beforeEach(() => {
  settled.length = 0;
  encounter = {
    id: 'encounter-1',
    sessionId: 'session-1',
    status: 'active',
    currentTurnOrder: 0,
    currentRound: 1,
  };
});

describe('advanceTurn settles check conditions', () => {
  test('a turn inside the round settles for the creature whose turn begins', async () => {
    await CombatInitiativeService.advanceTurn('encounter-1');

    expect(settled).toEqual([
      {
        encounterId: 'encounter-1',
        sessionId: 'session-1',
        startingParticipantId: 'goblin',
        roundNumber: 1,
        newRound: false,
      },
    ]);
  });

  test('wrapping the order starts the next round', async () => {
    encounter = { ...encounter, currentTurnOrder: 1 };

    await CombatInitiativeService.advanceTurn('encounter-1');

    expect(settled).toEqual([
      {
        encounterId: 'encounter-1',
        sessionId: 'session-1',
        startingParticipantId: 'player',
        roundNumber: 2,
        newRound: true,
      },
    ]);
  });
});
