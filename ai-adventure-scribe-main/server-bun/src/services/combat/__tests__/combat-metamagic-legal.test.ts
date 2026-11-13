import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

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
  characterClass: 'Paladin',
  characterLevel: 6,
  characterClassLevels: [{ className: 'Paladin', level: 6 }],
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
// #1148: a second, live monster so a test can put a dead monster and a live one
// side by side and prove the chips list only the live one. Same shape as the
// `getCombatState` producer's rows (no map entity: spell targets never read it,
// and the weapon path tolerates the missing entity via its geometry-undefined
// branch, so the live monster still gets a weapon chip).
// #1148: the participants the mocked `getCombatState` returns. Defaults to the
// original pair; a test that needs more hands the holder a longer list.
let participants = [player, monster];

mock.module('../combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => ({
      encounter: { id: 'encounter-1', sessionId: 'session-1', version: 1 },
      participants,
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
const profile: typeof APPRENTICE_PROFILE = NO_SPELLS;
const equippedWeapons: WeaponRuleProfile[] = [
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
  listCarriedWeaponProfiles: async () => [],
  listHealingConsumables: async () => healingConsumables,
  remainingSpellSlots: async () => slotRemaining,
  monsterAttackSource: () => 'derived',
  verifyCharacterOwnership: async () => {},
  verifyEncounterAccess: async () => {},
}));

/**
 * #1147: the healing consumables on the character's sheet, as `listHealingConsumables`
 * (data-access.ts) returns them: id, name, and the healing-dice expression from the item's
 * properties. The legal-action computation is what this suite pins, so the read is stubbed
 * at its module boundary behind a mutable holder.
 */
const healingConsumables: Array<{ id: string; name: string; healingDice: string }> = [
  { id: 'potion-1', name: 'Potion of Healing', healingDice: '2d4+2' },
  { id: 'potion-2', name: 'Potion of Greater Healing', healingDice: '4d4+4' },
];

/**
 * #1185: the remaining spell slots behind `remainingSpellSlots` (data-access.ts), as a
 * level-to-remaining map, or null when the character has no slot rows at all. The
 * legal-action computation is what this suite pins, so the read is stubbed at its module
 * boundary behind a mutable holder, defaulting to "no slot rows" — the fail-open ledger
 * state every pre-#1185 actor reads as. The end-to-end behaviour (real rows, spends,
 * refusals) is pinned against a real database in npc-engine-rows.real-db.test.ts.
 */
const slotRemaining: Map<number, number> | null = null;

/**
 * #975: the Fighter features' tracked uses live behind `fighterFeatureUses`
 * (a sheet read). The legal-action computation is what this suite pins, so the
 * read is stubbed at its module boundary — a mutable holder, defaulting to "no
 * feature rows on the sheet", which is what every pre-#975 actor reads as. The
 * end-to-end behaviour (real rows, spends, refusals) is pinned against a real
 * database in encounter-lifecycle.real-db.test.ts.
 */
const featureUses: { secondWind: number | null; actionSurge: number | null } = {
  secondWind: null,
  actionSurge: null,
};
const divineSenseRemaining: number | null = 1;
/**
 * #1414: the Inspiration flag on the actor's character, as `CharacterService.characterHasInspiration`
 * reads it from the personality envelope. The legal-action computation is what this suite pins,
 * so the read is stubbed at its module boundary behind a mutable holder, defaulting to "no
 * inspiration" — the state every pre-#1414 actor reads as. The end-to-end behaviour (real rows,
 * spends, refusals) is pinned against a real database in limited-feature-uses.real-db.test.ts.
 */
const hasInspiration = false;
/** #1414 round 4 (CI fix): when set, the character read throws — the mocked-route shape
 * (an empty db object). The offering must fail closed, not fail the whole response. */
const inspirationReadThrows = false;
mock.module('../../character-service.js', () => ({
  CharacterService: {
    characterHasInspiration: async () => {
      if (inspirationReadThrows) throw new Error('db.query is not available');
      return hasInspiration;
    },
  },
}));
mock.module('../fighter-features-service.js', () => ({
  fighterFeatureUses: async () => featureUses,
  resolveSecondWind: async () => {
    throw new Error('resolveSecondWind is not under test in this suite');
  },
  resolveActionSurge: async () => {
    throw new Error('resolveActionSurge is not under test in this suite');
  },
}));
mock.module('../../progression/paladin-features-service.js', () => ({
  paladinLevelOf: (character: {
    class: string | null;
    level: number | null;
    classLevels: unknown;
  }) => {
    const levels = Array.isArray(character.classLevels) ? character.classLevels : [];
    return levels.reduce((total, entry) => {
      if (!entry || typeof entry !== 'object') return total;
      const item = entry as { className?: unknown; level?: unknown };
      return typeof item.className === 'string' && item.className.toLowerCase() === 'paladin'
        ? total + (typeof item.level === 'number' ? item.level : 0)
        : total;
    }, 0);
  },
  divineSenseUses: async () =>
    divineSenseRemaining === null ? null : { row: { usesRemaining: divineSenseRemaining } },
}));

/**
 * #1233: the slot and sorcery-point ledgers behind Flexible Casting, stubbed at the module
 * boundary (resource-ledger.ts). The real reads are pinned against a real database in
 * flexible-casting.real-db.test.ts. Defaults: no pool, no slots.
 */
let sorceryPool: { max: number; remaining: number } | null = null;
let ledgerSlots = new Map<number, number>();
let knownMetamagic: string[] = [];
mock.module('../resource-ledger.js', () => ({
  spellSlotLedger: async () => ledgerSlots,
  sorceryPointsLedger: async () => sorceryPool,
  metamagicOptionsLedger: async () => knownMetamagic,
}));

const { getLegalCombatActions } = await import('../combat-intent-service.js');

type MetamagicOffer = Record<string, unknown> & { type: string };
function metamagicOffers(actions: Array<{ type: string }>): MetamagicOffer[] {
  return actions.filter((action) => action.type === 'metamagic') as MetamagicOffer[];
}

describe('getLegalCombatActions Metamagic (#1233)', () => {
  beforeEach(() => {
    player.characterClass = 'Sorcerer';
    player.characterLevel = 3;
    player.characterClassLevels = [{ className: 'Sorcerer', level: 3 }];
    player.actionUsed = false;
    player.bonusActionUsed = false;
    sorceryPool = { max: 3, remaining: 3 };
    knownMetamagic = ['quickened', 'careful'];
    ledgerSlots = new Map([[1, 4]]);
    participants = [player, monster];
  });

  afterEach(() => {
    sorceryPool = null;
    knownMetamagic = [];
    ledgerSlots = new Map();
    player.characterClass = 'Paladin';
    player.characterLevel = 6;
    player.characterClassLevels = [{ className: 'Paladin', level: 6 }];
  });

  test('a known option the pool can pay is offered with its engine cost and casting time', async () => {
    const offers = metamagicOffers((await getLegalCombatActions('encounter-1', 'user-1')).actions);
    expect(offers.map((offer) => [offer.option, offer.pointsCost, offer.castingTime])).toEqual([
      ['quickened', 2, 'bonus action'],
      ['careful', 1, 'as the spell'],
    ]);
  });

  test('Quickened with one point left is not offered; Careful still is', async () => {
    sorceryPool = { max: 3, remaining: 1 };
    const offers = metamagicOffers((await getLegalCombatActions('encounter-1', 'user-1')).actions);
    expect(offers.map((offer) => offer.option)).toEqual(['careful']);
  });

  test('no stored list means no Metamagic offer (fail closed)', async () => {
    knownMetamagic = [];
    const offers = metamagicOffers((await getLegalCombatActions('encounter-1', 'user-1')).actions);
    expect(offers).toHaveLength(0);
  });

  test('a Paladin with a stored list is not offered Metamagic', async () => {
    player.characterClass = 'Paladin';
    const offers = metamagicOffers((await getLegalCombatActions('encounter-1', 'user-1')).actions);
    expect(offers).toHaveLength(0);
  });

  test('no sorcery-point pool means no Metamagic offer', async () => {
    sorceryPool = null;
    const offers = metamagicOffers((await getLegalCombatActions('encounter-1', 'user-1')).actions);
    expect(offers).toHaveLength(0);
  });
});

describe('Twinned Spell is offered only for a spell it can apply to (#1233)', () => {
  beforeEach(() => {
    player.characterClass = 'Sorcerer';
    player.characterLevel = 3;
    player.characterClassLevels = [{ className: 'Sorcerer', level: 3 }];
    player.actionUsed = false;
    player.bonusActionUsed = false;
    sorceryPool = { max: 3, remaining: 3 };
    knownMetamagic = ['twinned'];
    ledgerSlots = new Map([[1, 4]]);
    participants = [player, monster];
  });

  afterEach(() => {
    profile.spellIds = [];
    sorceryPool = null;
    knownMetamagic = [];
    ledgerSlots = new Map();
    player.characterClass = 'Paladin';
    player.characterLevel = 6;
    player.characterClassLevels = [{ className: 'Paladin', level: 6 }];
  });

  test('not offered when the only player spell is multi-target (Magic Missile)', async () => {
    profile.spellIds = ['magic-missile'];
    const offers = metamagicOffers((await getLegalCombatActions('encounter-1', 'user-1')).actions);
    expect(offers.map((offer) => offer.option)).toEqual([]);
  });

  test('offered, with no points cost of its own, when a single-target spell is held (Fire Bolt)', async () => {
    profile.spellIds = ['fire-bolt'];
    const offers = metamagicOffers((await getLegalCombatActions('encounter-1', 'user-1')).actions);
    expect(offers.map((offer) => [offer.option, offer.pointsCost])).toEqual([['twinned', null]]);
  });
});
