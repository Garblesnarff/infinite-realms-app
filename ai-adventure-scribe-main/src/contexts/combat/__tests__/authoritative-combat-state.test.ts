import { describe, expect, it } from 'vitest';

import { rosterEntryForParticipant } from '../../../../shared/engine-display-name';
import { mapAuthoritativeCombat } from '../authoritative-combat-state';

import type { AuthoritativeCombatPayload } from '../authoritative-combat-state';

// Shape of a combat_participants row as getCombatState returns it: `monsterAttack` is the
// stored profile jsonb, and `displayName` is set on it at seating (#2398).
const participant = (id: string, name: string, monsterAttack: unknown) => ({
  id,
  name,
  participantType: 'monster',
  initiative: 10,
  initiativeModifier: 0,
  armorClass: 14,
  maxHp: 80,
  speed: 30,
  isActive: true,
  monsterAttack: monsterAttack as { displayName?: string } | null,
});

const payload: AuthoritativeCombatPayload = {
  encounter: {
    id: 'enc-1',
    sessionId: 'sess-1',
    status: 'active',
    currentRound: 1,
    currentTurnOrder: 0,
    startedAt: '2026-09-30T00:00:00Z',
  },
  participants: [
    participant('p1', 'Corrupted Shard A', {
      source: 'authored',
      attacks: [],
      displayName: 'Flavor-Elemental (Corrupted) 1',
    }),
    participant('p2', 'Doorkeeper', { source: 'derived', attacks: [] }),
  ],
};

describe('mapAuthoritativeCombat display name (#2398)', () => {
  const [shard, doorkeeper] = mapAuthoritativeCombat(payload).participants;

  it('keeps the DM label as the participant name and carries the heading beside it', () => {
    expect(shard.name).toBe('Corrupted Shard A');
    expect(shard.displayName).toBe('Flavor-Elemental (Corrupted) 1');
    expect(doorkeeper.displayName).toBeUndefined();
  });

  it('feeds the roster builders the engine lines use', () => {
    expect(rosterEntryForParticipant(shard)).toEqual({
      id: 'p1',
      name: 'Corrupted Shard A',
      displayName: 'Flavor-Elemental (Corrupted) 1',
    });
    expect(rosterEntryForParticipant(doorkeeper)).toEqual({ id: 'p2', name: 'Doorkeeper' });
  });
});
