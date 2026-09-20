import { describe, expect, mock, test } from 'bun:test';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

const player = {
  id: 'player-1',
  name: 'The Veteran',
  participantType: 'player',
  isActive: true,
  actionUsed: false,
  bonusActionUsed: false,
  armorClass: 18,
  characterId: 'character-1',
  encounterId: 'encounter-1',
};
const monster = {
  id: 'monster-1',
  name: 'Chiropteran Hulk',
  participantType: 'monster',
  isActive: true,
  actionUsed: false,
  bonusActionUsed: false,
  armorClass: 14,
  encounterId: 'encounter-1',
};

mock.module('../combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => ({
      encounter: { id: 'encounter-1', sessionId: 'session-1', version: 1 },
      participants: [player, monster],
      currentParticipant: player,
    }),
  },
}));
const map = {
  id: 'map-1',
  sessionId: 'session-1',
  width: 10,
  height: 10,
  round: 1,
  sceneDescription: 'cave',
  cells: Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'player-1',
      name: 'The Veteran',
      x: 6,
      y: 6,
      size: 'medium' as const,
      type: 'pc' as const,
      speedFeet: 30,
      movementRemaining: 0,
    },
    {
      id: 'monster-1',
      name: 'Chiropteran Hulk',
      x: 8,
      y: 8,
      size: 'medium' as const,
      type: 'monster' as const,
      speedFeet: 10,
      movementRemaining: 10,
    },
  ],
};
mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => map,
  loadLatestTacticalMapRow: async () => null,
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));
mock.module('../data-access.js', () => ({
  claimEncounterVersion: async () => 1,
  createWeaponAttack: async () => null,
  getActiveConditionNames: async () => [],
  getEquippedWeaponProfile: async () => ({
    id: 'longsword',
    name: 'Longsword',
    damageDice: '1d8',
    damageType: 'slashing',
    normalRange: 5,
    magicBonus: 0,
    finesse: false,
    ranged: false,
    proficient: true,
  }),
  getParticipantAbilityProfile: async () => ({
    level: 1,
    scores: { str: 16, dex: 10 },
    savingThrowProficiencies: [],
    saveBonuses: {},
    spellIds: [],
  }),
  getParticipantInEncounter: async () => null,
  getParticipantWithStats: async () => null,
  getParticipantsWithStatsBatch: async () => [],
  getCreatureStats: async () => null,
  getCreatureStatsBatch: async () => new Map(),
  getWeaponAttack: async () => null,
  getCharacterWeapons: async () => [],
  listEquippedWeaponProfiles: async () => [],
  monsterAttackSource: () => 'derived',
  verifyCharacterOwnership: async () => {},
  verifyEncounterAccess: async () => {},
}));

const { getLegalCombatActions } = await import('../combat-intent-service.js');

describe('getLegalCombatActions', () => {
  test('does not offer Move after a full-speed entry approach reaches zero', async () => {
    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions.some((action) => action.type === 'move')).toBe(false);
    expect(result.actions).toContainEqual({ type: 'end_turn', label: 'End turn' });
  });
});
