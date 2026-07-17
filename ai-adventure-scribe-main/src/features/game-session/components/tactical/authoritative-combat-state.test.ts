import { describe, expect, it } from 'vitest';

import { mapAuthoritativeCombat } from '../../../../contexts/combat/authoritative-combat-state';

describe('authoritative combat hydration', () => {
  it('restores exact turn, HP, conditions, and action economy after reconnect', () => {
    const encounter = mapAuthoritativeCombat({
      encounter: {
        id: 'enc', sessionId: 'session', status: 'active', currentRound: 3,
        currentTurnOrder: 1, startedAt: '2026-07-14T00:00:00.000Z',
      },
      participants: [
        {
          id: 'pc', characterId: 'character', name: 'Hero', participantType: 'player',
          initiative: 18, initiativeModifier: 3, armorClass: 17, maxHp: 24, speed: 30,
          actionUsed: true, status: { currentHp: 11, maxHp: 24, tempHp: 2, isConscious: true },
          conditions: [{ condition: { name: 'Poisoned', description: 'Disadvantage on attacks.' } }],
        },
        {
          id: 'goblin', name: 'Goblin', participantType: 'npc', initiative: 15,
          initiativeModifier: 2, armorClass: 15, maxHp: 7, speed: 30,
          status: { currentHp: 4, maxHp: 7, tempHp: 0, isConscious: true }, conditions: [],
        },
      ],
    });
    expect(encounter).toMatchObject({ currentRound: 3, currentTurnParticipantId: 'goblin' });
    expect(encounter.participants[0]).toMatchObject({
      currentHitPoints: 11, temporaryHitPoints: 2, actionTaken: true,
    });
    expect(encounter.participants[0].conditions[0].name).toBe('poisoned');
  });
});
