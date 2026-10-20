import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * #728 / #810: the mook no-drop rule on the spell save path, end to end.
 *
 * The rule's two halves were previously tested apart: combat-spell-resolution.vitest.ts
 * mocks CombatHPService.applyDamage and asserts the `saveSucceeded` flag, and
 * mook-drop.test.ts calls HPMechanics directly. This suite mocks neither — it drives
 * CombatAttackService.resolveSpellAttack (Burning Hands) into the real
 * CombatHPService.applyDamage and the real HPMechanics, with only the DB-facing
 * leaves stubbed, and asserts the HP that comes out (and the HP patch the service
 * writes) for a mook that makes its save and for one that fails.
 *
 * Fixtures follow the real producers: the roster map mirrors
 * getParticipantsWithStatsBatch's output as consumed by resolveSpellAttack
 * (participant carrying its status and encounter), and the ability profiles mirror
 * getParticipantAbilityProfile's shape from combat-spell-resolution.vitest.ts.
 */

// HP patches captured from the mocked db.update chain CombatHPService writes through.
const hpPatches: Array<Record<string, unknown>> = [];

function updateChain() {
  return {
    set: (patch: Record<string, unknown>) => {
      if ('currentHp' in patch) hpPatches.push(patch);
      return {
        where: () => {
          const rows = [{ id: 'status-row' }];
          return Object.assign(Promise.resolve(rows), { returning: async () => rows });
        },
      };
    },
  };
}

// CombatHPService builds (never executes) an ownership subquery when a userId is
// present; the chain only needs to be buildable.
function selectChain(): any {
  const chain: any = {};
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  return chain;
}

mock.module('../../../../../db/client', () => ({
  db: {
    update: () => updateChain(),
    insert: () => ({ values: async () => {} }),
    select: () => selectChain(),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({ update: () => updateChain() }),
  },
}));

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
mock.module('../../../lib/logger.js', () => ({
  logger: silentLogger,
  combatLogger: silentLogger,
  spellLogger: silentLogger,
  progressionLogger: silentLogger,
  errorLogSerializers: {},
  default: silentLogger,
}));

const ENCOUNTER_ID = 'encounter-mook-spell-save';
const USER_ID = 'user-mook-spell-save';
const CASTER_ID = 'caster-mook-spell-save';
const MOOK_ID = 'mook-spell-save';

const casterProfile = {
  level: 1,
  className: 'Wizard',
  savingThrowProficiencies: [],
  scores: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  saveBonuses: {},
  spellIds: ['burning-hands'],
};

const mookProfile = {
  level: 1,
  className: null,
  savingThrowProficiencies: [],
  scores: { dex: 10 },
  saveBonuses: {},
  spellIds: [],
};

function roster() {
  const caster = {
    id: CASTER_ID,
    name: 'Rook',
    participantType: 'player',
    characterId: 'character-mook-spell-save',
    armorClass: 12,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    encounter: { sessionId: 'session-mook-spell-save', currentRound: 1 },
  };
  const mook = {
    id: MOOK_ID,
    name: 'Goblin Mook',
    participantType: 'monster',
    characterId: null,
    isMook: true,
    armorClass: 13,
    maxHp: 10,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    status: {
      currentHp: 10,
      maxHp: 10,
      tempHp: 0,
      isConscious: true,
      isDead: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    },
    encounter: { sessionId: 'session-mook-spell-save', currentRound: 1 },
  };
  return new Map([
    [CASTER_ID, { participant: caster, stats: null }],
    [MOOK_ID, { participant: mook, stats: null }],
  ]);
}

mock.module('../../combat-initiative-service.js', () => ({
  CombatInitiativeService: {
    getCurrentTurn: async () => ({ id: CASTER_ID }),
  },
}));

mock.module('../data-access.js', () => ({
  getParticipantWithStats: async () => null,
  getParticipantsWithStatsBatch: async () => roster(),
  getWeaponAttack: async () => null,
  getCharacterWeapons: async () => [],
  getCreatureStats: async () => null,
  getCreatureStatsBatch: async () => new Map(),
  createWeaponAttack: async () => null,
  getParticipantAbilityProfile: async (participant: { id: string }) =>
    participant.id === CASTER_ID ? casterProfile : mookProfile,
  getActiveConditionNames: async () => [],
  getEquippedWeaponProfile: async () => null,
  monsterAttackSource: () => 'generic',
  verifyEncounterAccess: async () => {},
  // combat-attack-service imports it for the mook pack bonus (#728); a mocked
  // module missing an export is a hard SyntaxError for every importer.
  countStandingMooks: async () => 0,
}));

mock.module('../combat-turn-resources.js', () => ({
  claimTurnActionAndResolve: async (
    _participantId: string,
    _encounterId: string,
    version: number,
    resolve: (version: number) => Promise<unknown>,
  ) => resolve(version),
  claimTurnBonusActionAndResolve: async (
    _participantId: string,
    _encounterId: string,
    version: number,
    resolve: (version: number) => Promise<unknown>,
  ) => resolve(version),
  claimTurnReactionAndResolve: async (
    _participantId: string,
    _encounterId: string,
    version: number,
    resolve: (version: number) => Promise<unknown>,
  ) => resolve(version),
}));

mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
}));

mock.module('../npc-provocation.js', () => ({
  markPlayerDamageProvocation: async () => [],
}));

mock.module('../../spell-slots-service.js', () => ({
  SpellSlotsService: { useSpellSlot: async () => ({ used: true }) },
}));

mock.module('../../../tactical/engine.js', () => ({
  checkLineOfSight: () => true,
  getCover: () => 0,
  getDistance: () => 30,
}));

const { CombatAttackService } = await import('../combat-attack-service.js');

// Dice choreography: the first Math.random is the target's save roll (as in
// combat-spell-resolution.vitest.ts); every later roll uses the fallback.
const realRandom = Math.random;
let randomQueue: number[] = [];
let randomFallback = 0;

beforeEach(() => {
  hpPatches.length = 0;
  randomQueue = [];
  randomFallback = 0;
  Math.random = () =>
    randomQueue.length > 0 ? (randomQueue.shift() as number) : randomFallback;
});

afterEach(() => {
  Math.random = realRandom;
});

function castBurningHandsAtMook() {
  return new CombatAttackService().resolveSpellAttack(
    ENCOUNTER_ID,
    {
      casterId: CASTER_ID,
      targetIds: [MOOK_ID],
      spellName: 'Burning Hands',
      slotLevel: 1,
      expectedVersion: 7,
    },
    USER_ID,
  );
}

describe('mook on the spell save path (real CombatHPService + HPMechanics)', () => {
  it('keeps a mook standing at half damage when it succeeds on the save', async () => {
    // Save roll 0.95 -> 20 vs DC 13 (success); damage dice 0.999 -> 6 each, 3d6 = 18, half = 9.
    randomQueue = [0.95];
    randomFallback = 0.999;

    const result = await castBurningHandsAtMook();

    expect(result.results[0]).toMatchObject({
      saved: true,
      saveRoll: 20,
      saveDC: 13,
      finalDamage: 9,
      targetNewHp: 1,
      targetIsConscious: true,
      targetIsDead: false,
    });
    // The HP the service actually wrote: 10 - 9 = 1, still conscious. Without the
    // saveSucceeded guard the mook rule would have written 0.
    expect(hpPatches).toHaveLength(1);
    expect(hpPatches[0]).toMatchObject({ currentHp: 1, isConscious: true });
  });

  it('drops a mook to 0 when it fails the save', async () => {
    // Save roll 0 -> 1 vs DC 13 (failure); damage dice 0.999 -> 3d6 = 18 in full.
    randomQueue = [0];
    randomFallback = 0.999;

    const result = await castBurningHandsAtMook();

    expect(result.results[0]).toMatchObject({
      saved: false,
      saveRoll: 1,
      saveDC: 13,
      finalDamage: 18,
      targetNewHp: 0,
      targetIsConscious: false,
    });
    expect(hpPatches).toHaveLength(1);
    expect(hpPatches[0]).toMatchObject({ currentHp: 0, isConscious: false });
  });
});
