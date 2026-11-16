import { describe, expect, it } from 'vitest';

import { buildEncounterCombatants } from '../useOverhaulViewModel';

import {
  mapAuthoritativeCombat,
  type AuthoritativeCombatPayload,
} from '@/contexts/combat/authoritative-combat-state';

describe('buildEncounterCombatants', () => {
  it('uses displayName from monsterAttack when present', () => {
    const payload: AuthoritativeCombatPayload = {
      encounter: {
        id: 'enc-2',
        sessionId: 's-1',
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        startedAt: '2026-10-24T14:14:57Z',
      },
      participants: [
        {
          id: 'p-1',
          name: 'Tavo',
          participantType: 'player',
          characterId: 'c-1',
          initiative: 15,
          initiativeModifier: 3,
          armorClass: 14,
          maxHp: 20,
          speed: 30,
        },
        {
          id: 'm-1',
          name: 'Glass Prowler',
          participantType: 'monster',
          initiative: 12,
          initiativeModifier: 2,
          armorClass: 13,
          maxHp: 8,
          speed: 30,
          monsterAttack: { displayName: 'Glass-Hide Ape' },
        },
      ],
    };

    const encounter = mapAuthoritativeCombat(payload);
    const result = buildEncounterCombatants(encounter, null);
    const monster = result.find((c) => c.id === 'm-1');
    const player = result.find((c) => c.id === 'p-1');

    expect(monster?.name).toBe('Glass-Hide Ape');
    expect(player?.name).toBe('Tavo');
  });

  it('keeps its name when monsterAttack is missing', () => {
    const payload: AuthoritativeCombatPayload = {
      encounter: {
        id: 'enc-3',
        sessionId: 's-1',
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        startedAt: '2026-10-24T14:14:57Z',
      },
      participants: [
        {
          id: 'm-2',
          name: 'Goblin',
          participantType: 'monster',
          initiative: 10,
          initiativeModifier: 1,
          armorClass: 15,
          maxHp: 7,
          speed: 30,
        },
      ],
    };

    const encounter = mapAuthoritativeCombat(payload);
    const result = buildEncounterCombatants(encounter, null);
    const monster = result.find((c) => c.id === 'm-2');
    expect(monster?.name).toBe('Goblin');
  });

  it('names a living enemy condition from hit points when the wire omitted the word (#1557)', () => {
    const payload: AuthoritativeCombatPayload = {
      encounter: {
        id: 'enc-4',
        sessionId: 's-1',
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        startedAt: '2026-11-15T00:00:00Z',
      },
      participants: [
        {
          id: 'm-hp',
          name: 'Wraith',
          participantType: 'monster',
          initiative: 10,
          initiativeModifier: 1,
          armorClass: 13,
          maxHp: 20,
          speed: 30,
          healthCondition: 'unharmed',
          status: { currentHp: 6, maxHp: 20, tempHp: 0, isConscious: true },
        },
      ],
    };

    const [foe] = buildEncounterCombatants(mapAuthoritativeCombat(payload), null);
    expect(foe?.healthCondition).toBe('bloodied');
    expect(foe).not.toHaveProperty('currentHitPoints');
    expect(foe).not.toHaveProperty('maxHitPoints');
    expect(JSON.stringify(foe)).not.toMatch(/\/\s*20/);
  });
});
