import { describe, expect, mock, test } from 'bun:test';

// player-exit-service.ts pulls in modules that reach the database; mock them so this
// suite runs with DATABASE_URL unset (CI's server unit job has no database).
mock.module('../tactical-action-service.js', () => ({
  recordDmTacticalFact: async () => {},
}));

mock.module('../../narrative/narrative-ledger-service.js', () => ({
  NarrativeLedgerService: {
    assertFact: async () => ({}),
  },
}));

const { selectOpportunityAttackers } = await import('../player-exit-service.js');

describe('selectOpportunityAttackers (#1642 thrown range)', () => {
  test('a thrown dagger selects an adjacent foe but not one 10 ft away', async () => {
    const actor = {
      id: 'hero',
      participantType: 'player',
      isActive: true,
      maxHp: 10,
      isDisengaged: false,
      status: { currentHp: 10, isConscious: true },
    };
    const closeFoe = {
      id: 'foe-close',
      participantType: 'npc',
      isActive: true,
      maxHp: 10,
      reactionUsed: false,
      status: { currentHp: 10, isConscious: true },
    };
    const farFoe = {
      id: 'foe-far',
      participantType: 'npc',
      isActive: true,
      maxHp: 10,
      reactionUsed: false,
      status: { currentHp: 10, isConscious: true },
    };
    const state = { participants: [actor, closeFoe, farFoe] } as any;
    const entities = [
      { id: 'hero', x: 0, y: 0 },
      { id: 'foe-close', x: 1, y: 0 },
      { id: 'foe-far', x: 2, y: 0 },
    ];
    const map = { entities } as any;
    const reachOf = async () => ({
      id: 'dagger',
      name: 'Dagger',
      normalRange: 20,
      longRange: 60,
      ranged: true,
      meleeWeapon: true,
    });
    const distanceFeet = (from: any, to: any) =>
      (Math.abs(from.x - to.x) + Math.abs(from.y - to.y)) * 5;

    const result = await selectOpportunityAttackers({
      state,
      actor: actor as any,
      map,
      reachOf: reachOf as any,
      hasLineOfSight: () => true,
      distanceFeet,
    });

    const ids = result.map((entry: any) => entry.participant.id);
    expect(ids).toContain('foe-close');
    expect(ids).not.toContain('foe-far');
  });
});
