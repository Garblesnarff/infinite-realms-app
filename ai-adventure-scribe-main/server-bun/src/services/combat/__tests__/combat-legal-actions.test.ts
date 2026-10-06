import { afterEach, describe, expect, mock, test } from 'bun:test';

import type { WeaponRuleProfile } from '../combat-rules.js';

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
  // `combat_participants.max_hp` is not null and every hydrated participant carries its status
  // row (`getCombatState` joins it); the dying-player branch of `getLegalCombatActions` reads
  // both, so the fixture carries them as the producer does.
  maxHp: 20,
  status: { currentHp: 20, isConscious: true, deathSavesSuccesses: 0, deathSavesFailures: 0 },
  turnOrder: 0,
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
  turnOrder: 1,
  // HP the way `getCombatState` supplies it. Absent, a participant reads as 0 HP and is not a
  // live hostile at all, which is a correct reading of a row that says nothing about vitals.
  maxHp: 27,
  status: { currentHp: 27, isConscious: true },
};

mock.module('../combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => ({
      encounter: { id: 'encounter-1', sessionId: 'session-1', version: 1 },
      participants: [player, monster],
      // Derived, as `getCombatState` does, so a test can hand the turn to the monster: pinning
      // the player here would have made "no exit chip on a monster's turn" untestable.
      currentParticipant: (player as { turnOrder?: number }).turnOrder === 0 ? player : monster,
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
/**
 * What `getParticipantAbilityProfile` (data-access.ts) returns for The Apprentice, the premade
 * wizard of run M8: cantrips, known and prepared spells split from the character's comma columns,
 * then the joined `character_spells` rows as id and name, all lowercased.
 */
const APPRENTICE_PROFILE = {
  level: 1,
  className: 'Wizard',
  savingThrowProficiencies: ['intelligence', 'wisdom'],
  scores: { str: 8, dex: 12, con: 14, int: 17, wis: 13, cha: 10 },
  saveBonuses: {},
  spellIds: [
    'acid-splash',
    'chill-touch',
    'dancing-lights',
    'alarm',
    'burning-hands',
    'charm-person',
    'color-spray',
    '0a1c59c5-6e0c-4d4b-8d9e-3f7d1a2b4c10',
    'chill touch',
  ],
};
const NO_SPELLS = { ...APPRENTICE_PROFILE, spellIds: [] };
let profile: typeof APPRENTICE_PROFILE = NO_SPELLS;
let equippedWeapons: WeaponRuleProfile[] = [
  {
    id: 'quarterstaff',
    name: 'Quarterstaff',
    damageDice: '1d6',
    damageType: 'bludgeoning',
    normalRange: 5,
    magicBonus: 1,
    finesse: false,
    ranged: false,
    proficient: true,
  },
];

mock.module('../data-access.js', () => ({
  claimEncounterVersion: async () => 1,
  createWeaponAttack: async () => null,
  getActiveConditionNames: async () => [],
  getEquippedWeaponProfile: async () => equippedWeapons[0],
  getParticipantAbilityProfile: async () => profile,
  getParticipantInEncounter: async () => null,
  getParticipantWithStats: async () => null,
  getParticipantsWithStatsBatch: async () => [],
  getCreatureStats: async () => null,
  getCreatureStatsBatch: async () => new Map(),
  getWeaponAttack: async () => null,
  getCharacterWeapons: async () => [],
  listEquippedWeaponProfiles: async () => equippedWeapons,
  monsterAttackSource: () => 'derived',
  verifyCharacterOwnership: async () => {},
  verifyEncounterAccess: async () => {},
}));

const { getLegalCombatActions } = await import('../combat-intent-service.js');

describe('getLegalCombatActions', () => {
  afterEach(() => {
    profile = NO_SPELLS;
    player.actionUsed = false;
    monster.isActive = true;
    equippedWeapons = [
      {
        id: 'quarterstaff',
        name: 'Quarterstaff',
        damageDice: '1d6',
        damageType: 'bludgeoning',
        normalRange: 5,
        magicBonus: 1,
        finesse: false,
        ranged: false,
        proficient: true,
      },
    ];
    map.entities[0].x = 6;
    map.entities[0].y = 6;
    map.entities[0].movementRemaining = 0;
    map.entities[1].x = 8;
    map.entities[1].y = 8;
  });

  test('offers the carried melee weapon at range with a move-closer hint', async () => {
    map.entities[0].x = 0;
    map.entities[0].y = 0;
    map.entities[1].x = 6;
    map.entities[1].y = 0;

    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions).toContainEqual(
      expect.objectContaining({
        type: 'attack',
        label: 'Attack with Quarterstaff (move closer first)',
        targetIds: ['monster-1'],
      }),
    );
  });

  test('plans Move toward the nearest hostile without spending the Action', async () => {
    map.entities[0].x = 0;
    map.entities[0].y = 0;
    map.entities[0].movementRemaining = 30;
    map.entities[1].x = 8;
    map.entities[1].y = 0;

    const result = await getLegalCombatActions('encounter-1', 'user-1');
    expect(result.actions).toContainEqual(expect.objectContaining({ type: 'move', x: 6, y: 0 }));
    expect(player.actionUsed).toBe(false);
  });

  test('does not offer a no-op Move when the nearest hostile is already in reach', async () => {
    map.entities[0].x = 0;
    map.entities[0].y = 0;
    map.entities[0].movementRemaining = 30;
    map.entities[1].x = 1;
    map.entities[1].y = 0;

    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions.some((action) => action.type === 'move')).toBe(false);
  });

  test('does not offer Move when there is no hostile on the map', async () => {
    monster.isActive = false;
    map.entities[0].movementRemaining = 30;

    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions.some((action) => action.type === 'move')).toBe(false);
  });

  test('offers every carried weapon, including a custom and a ranged profile', async () => {
    equippedWeapons = [
      equippedWeapons[0],
      {
        id: 'custom-moonblade',
        name: 'Moonblade',
        damageDice: '1d8',
        damageType: 'radiant',
        normalRange: 5,
        magicBonus: 0,
        finesse: true,
        ranged: false,
        proficient: true,
      },
      {
        id: 'longbow',
        name: 'Longbow',
        damageDice: '1d8',
        damageType: 'piercing',
        normalRange: 150,
        longRange: 600,
        magicBonus: 0,
        finesse: false,
        ranged: true,
        proficient: true,
      },
    ];
    map.entities[0].x = 0;
    map.entities[0].y = 0;
    map.entities[1].x = 6;
    map.entities[1].y = 0;

    const result = await getLegalCombatActions('encounter-1', 'user-1');
    const attacks = result.actions.filter((action) => action.type === 'attack');

    expect(attacks.map((action) => action.label)).toEqual([
      'Attack with Quarterstaff (move closer first)',
      'Attack with Moonblade (move closer first)',
      'Attack with Longbow',
    ]);
  });

  test('does not offer Move after a full-speed entry approach reaches zero', async () => {
    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions.some((action) => action.type === 'move')).toBe(false);
    expect(result.actions).toContainEqual({ type: 'end_turn', label: 'End turn' });
  });

  test("suggests one cast per spell on the character's own list, never one they lack (#2343 A3)", async () => {
    profile = APPRENTICE_PROFILE;

    const result = await getLegalCombatActions('encounter-1', 'user-1');
    const labels = result.actions.map((action) => action.label);

    expect(result.actions.filter((action) => action.type === 'spell')).toEqual([
      { type: 'spell', label: 'Cast Acid Splash', spellId: 'acid-splash' },
      { type: 'spell', label: 'Cast Chill Touch', spellId: 'chill-touch' },
      { type: 'spell', label: 'Cast Burning Hands', spellId: 'burning-hands' },
    ]);
    expect(labels).not.toContain('Cast a prepared spell');
    expect(labels).not.toContain('Cast Fire Bolt');
  });

  test('offers no cast to a character with no combat spell on their list', async () => {
    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions.some((action) => action.type === 'spell')).toBe(false);
  });

  // #2580: the way out of a fight. Offered outside the Action gate on purpose — a player whose
  // Action is spent is exactly the player stuck in a fight they cannot finish — and offered only
  // on the PLAYER's turn, because a monster leaving is the DM's declaration, not a chip.
  test("offers Flee and Yield on the player's turn, naming the hostile in reach", async () => {
    map.entities[0].x = 4;
    map.entities[0].y = 4;
    map.entities[1].x = 5;
    map.entities[1].y = 4;

    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions).toContainEqual({
      type: 'flee',
      label: 'Flee (Chiropteran Hulk attacks)',
    });
    expect(result.actions).toContainEqual({ type: 'yield', label: 'Yield' });
  });

  test('offers Flee unadorned when nothing is in reach', async () => {
    map.entities[0].x = 0;
    map.entities[0].y = 0;
    map.entities[1].x = 9;
    map.entities[1].y = 9;

    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions).toContainEqual({ type: 'flee', label: 'Flee' });
  });

  test('labels a plain Flee when the only hostile nearby carries a ranged weapon', async () => {
    // An opportunity attack is melee. The same bow that reaches 80 ft must not read as "in
    // reach" at 30 ft, nor at 5 ft: the label is the player's warning of what the exit costs.
    const melee = equippedWeapons;
    equippedWeapons = [
      {
        id: 'shortbow',
        name: 'Shortbow',
        damageDice: '1d6',
        damageType: 'piercing',
        normalRange: 80,
        longRange: 320,
        magicBonus: 0,
        finesse: false,
        ranged: true,
        proficient: true,
      },
    ];
    map.entities[0].x = 4;
    map.entities[0].y = 4;
    map.entities[1].x = 10 - 4; // 30 ft
    map.entities[1].y = 4;
    const far = await getLegalCombatActions('encounter-1', 'user-1');
    map.entities[1].x = 5; // 5 ft
    const adjacent = await getLegalCombatActions('encounter-1', 'user-1');
    equippedWeapons = melee;

    expect(far.actions).toContainEqual({ type: 'flee', label: 'Flee' });
    expect(adjacent.actions).toContainEqual({ type: 'flee', label: 'Flee' });
  });

  test('offers them to a player whose Action is already spent', async () => {
    player.actionUsed = true;

    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions.some((action) => action.type === 'flee')).toBe(true);
  });

  test('offers neither chip on a monster’s turn', async () => {
    player.actionUsed = false;
    // The turn moves to the Hulk; restored immediately so no later case inherits it.
    monster.turnOrder = 0;
    player.turnOrder = 1;

    const result = await getLegalCombatActions('encounter-1', 'user-1');
    monster.turnOrder = 1;
    player.turnOrder = 0;

    expect(result.actions.some((action) => action.type === 'flee' || action.type === 'yield')).toBe(
      false,
    );
  });

  test('offers no cast once the action is spent', async () => {
    profile = APPRENTICE_PROFILE;
    player.actionUsed = true;

    const result = await getLegalCombatActions('encounter-1', 'user-1');

    expect(result.actions.some((action) => action.type === 'spell')).toBe(false);
  });
});
