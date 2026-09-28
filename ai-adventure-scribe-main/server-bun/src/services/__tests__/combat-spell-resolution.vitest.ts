/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getParticipantsWithStatsBatch = vi.fn();
const getParticipantAbilityProfile = vi.fn();
const getActiveConditionNames = vi.fn();
const applyDamage = vi.fn();
const useSpellSlot = vi.fn();
const getCurrentTurn = vi.fn();
const loadActiveTacticalMap = vi.fn();
const markPlayerDamageProvocation = vi.fn();
const random = vi.spyOn(Math, 'random');

vi.mock('../combat/data-access.js', () => ({
  getParticipantWithStats: vi.fn(),
  getParticipantsWithStatsBatch,
  getWeaponAttack: vi.fn(),
  getCharacterWeapons: vi.fn(),
  getCreatureStats: vi.fn(),
  getCreatureStatsBatch: vi.fn(),
  createWeaponAttack: vi.fn(),
  getParticipantAbilityProfile,
  getActiveConditionNames,
  getEquippedWeaponProfile: vi.fn(),
  monsterAttackSource: vi.fn(),
}));

vi.mock('../combat/combat-turn-resources.js', () => ({
  claimTurnActionAndResolve: vi.fn(
    async (
      _participantId: string,
      _encounterId: string,
      version: number,
      resolve: (version: number) => Promise<unknown>,
    ) => resolve(version),
  ),
  claimTurnBonusActionAndResolve: vi.fn(
    async (
      _participantId: string,
      _encounterId: string,
      version: number,
      resolve: (version: number) => Promise<unknown>,
    ) => resolve(version),
  ),
}));

vi.mock('../combat-hp-service.js', () => ({
  CombatHPService: {
    applyDamage,
    healDamage: vi.fn(),
  },
}));

vi.mock('../combat-initiative-service.js', () => ({ CombatInitiativeService: { getCurrentTurn } }));
vi.mock('../combat/tactical-map-store.js', () => ({ loadActiveTacticalMap }));
vi.mock('../combat/npc-provocation.js', () => ({ markPlayerDamageProvocation }));
vi.mock('../spell-slots-service.js', () => ({ SpellSlotsService: { useSpellSlot } }));
vi.mock('../../lib/logger.js', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../tactical/engine.js', () => ({
  checkLineOfSight: vi.fn(() => true),
  getCover: vi.fn(() => 0),
  getDistance: vi.fn(() => 30),
}));

const { getCover } = await import('../../tactical/engine.js');
const { CombatAttackService } = await import('../combat/combat-attack-service.js');

const encounterId = 'encounter-spell-test';
const userId = 'user-spell-test';
const casterId = 'caster-spell-test';
const targetId = 'target-spell-test';

const casterProfile = {
  level: 1,
  className: 'Wizard',
  savingThrowProficiencies: [],
  scores: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  saveBonuses: {},
  spellIds: [
    'acid-splash',
    'fire-bolt',
    'ray-of-frost',
    'chill-touch',
    'eldritch-blast',
    'sacred-flame',
    'magic-missile',
  ],
};

const targetProfile = {
  level: 1,
  className: null,
  savingThrowProficiencies: [],
  scores: { dex: 10 },
  saveBonuses: {},
  spellIds: [],
};

function participantMap(targetArmorClass = 15) {
  const caster = {
    id: casterId,
    name: 'Rook',
    participantType: 'player',
    characterId: 'character-spell-test',
    armorClass: 12,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    encounter: { sessionId: 'session-spell-test', currentRound: 1 },
  };
  const target = {
    id: targetId,
    name: 'Professor Umeboshi',
    participantType: 'monster',
    characterId: null,
    armorClass: targetArmorClass,
    maxHp: 100,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    status: { currentHp: 100, isConscious: true, isDead: false },
    encounter: { sessionId: 'session-spell-test', currentRound: 1 },
  };
  return new Map([
    [casterId, { participant: caster, stats: null }],
    [targetId, { participant: target, stats: null }],
  ]);
}

function configureResolution(targetArmorClass = 15) {
  getCurrentTurn.mockResolvedValue({ id: casterId });
  getParticipantsWithStatsBatch.mockResolvedValue(participantMap(targetArmorClass));
  getParticipantAbilityProfile.mockImplementation(async (participant: { id: string }) =>
    participant.id === casterId ? casterProfile : targetProfile,
  );
  getActiveConditionNames.mockResolvedValue([]);
  loadActiveTacticalMap.mockResolvedValue(null);
  markPlayerDamageProvocation.mockResolvedValue([]);
  useSpellSlot.mockResolvedValue({ used: true });
  applyDamage.mockImplementation(
    async (
      _participantId: string,
      _encounterId: string,
      options: { damageAmount: number },
      _userId: string,
      participant: { status?: { currentHp?: number } },
    ) => {
      const damage = Number(options.damageAmount);
      const newCurrentHp = Number(participant.status?.currentHp ?? 100) - damage;
      return {
        damageDealt: damage,
        newCurrentHp,
        isConscious: newCurrentHp > 0,
        isDead: newCurrentHp <= 0,
      };
    },
  );
}

function resolveSpell(spellName: string, slotLevel?: number | null, d20?: number) {
  return new CombatAttackService().resolveSpellAttack(
    encounterId,
    {
      casterId,
      targetIds: [targetId],
      spellName,
      slotLevel,
      d20,
      expectedVersion: 7,
    },
    userId,
  );
}

describe('CombatAttackService.resolveSpellAttack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    random.mockReset().mockReturnValue(0);
    configureResolution();
  });

  it('rolls a spell attack server-side when no player d20 is supplied', async () => {
    random.mockReset().mockReturnValueOnce(0.45).mockReturnValueOnce(0);

    const result = await resolveSpell('Fire Bolt');

    expect(result.results[0]).toMatchObject({
      hit: true,
      d20: 10,
      attackBonus: 5,
      totalAttackRoll: 15,
      targetAC: 15,
      finalDamage: 1,
      targetNewHp: 99,
    });
    expect(applyDamage).toHaveBeenCalledTimes(1);
  });

  it('uses the player d20 for a spell attack without rolling a second attack die', async () => {
    random.mockReset().mockReturnValue(0);

    const result = await resolveSpell('Fire Bolt', undefined, 17);

    expect(result.results[0]).toMatchObject({
      hit: true,
      d20: 17,
      attackBonus: 5,
      totalAttackRoll: 22,
      targetAC: 15,
      finalDamage: 1,
    });
    expect(applyDamage).toHaveBeenCalledTimes(1);
  });

  it('keeps the same seated AC across two rounds and explains the cover bonus', async () => {
    const seated = 12;
    const rows = participantMap(seated);
    rows.get(targetId)!.stats = { armorClass: 14 } as never;
    getParticipantsWithStatsBatch.mockResolvedValue(rows);
    loadActiveTacticalMap.mockResolvedValue({
      entities: [
        { id: casterId, x: 0, y: 0 },
        { id: targetId, x: 4, y: 0 },
      ],
    });
    vi.mocked(getCover).mockReturnValue(1 as never);

    const first = await resolveSpell('Fire Bolt', undefined, 15);
    const second = await resolveSpell('Fire Bolt', undefined, 11);

    for (const round of [first.results[0], second.results[0]]) {
      expect(round).toMatchObject({
        baseAc: seated,
        coverBonus: 2,
        cover: 1,
        targetAC: seated + 2,
      });
    }
    expect(first.results[0]?.baseAc).toBe(second.results[0]?.baseAc);
    expect(first.results[0]?.coverBonus).toBe(second.results[0]?.coverBonus);
  });

  it('resolves a spell attack miss against AC without an HP write', async () => {
    random.mockReset().mockReturnValue(0);

    const result = await resolveSpell('Fire Bolt');

    expect(result.results[0]).toMatchObject({
      hit: false,
      d20: 1,
      attackBonus: 5,
      totalAttackRoll: 6,
      targetAC: 15,
      finalDamage: 0,
    });
    expect(applyDamage).not.toHaveBeenCalled();
  });

  it('resolves a failed saving throw against DC with full damage', async () => {
    random.mockReset().mockReturnValueOnce(0).mockReturnValueOnce(0);

    const result = await resolveSpell('Acid Splash');

    expect(result.results[0]).toMatchObject({
      hit: true,
      saveAbility: 'dexterity',
      saveRoll: 1,
      saveDC: 13,
      saved: false,
      finalDamage: 1,
    });
    expect(applyDamage).toHaveBeenCalledTimes(1);
  });

  it('resolves a passed saving throw against DC with zero damage', async () => {
    random.mockReset().mockReturnValueOnce(0.95).mockReturnValueOnce(0);

    const result = await resolveSpell('Sacred Flame');

    expect(result.results[0]).toMatchObject({
      hit: false,
      saveAbility: 'dexterity',
      saveRoll: 20,
      saveDC: 13,
      saved: true,
      finalDamage: 0,
    });
    expect(applyDamage).toHaveBeenCalledWith(
      targetId,
      encounterId,
      expect.objectContaining({ damageAmount: 0 }),
      userId,
      expect.any(Object),
    );
  });

  it.each([
    [1, 6, 3],
    [2, 8, 4],
  ])(
    'resolves Magic Missile slot %i as %i damage from %i darts',
    async (slotLevel, damage, darts) => {
      random.mockReset().mockReturnValue(0);

      const result = await resolveSpell('Magic Missile', slotLevel);

      expect(result.results[0]).toMatchObject({
        hit: true,
        autoHit: true,
        finalDamage: damage,
      });
      expect(applyDamage).toHaveBeenCalledWith(
        targetId,
        encounterId,
        expect.objectContaining({ damageAmount: damage }),
        userId,
        expect.any(Object),
      );
      expect(useSpellSlot).toHaveBeenCalledWith(
        expect.objectContaining({ slotLevelUsed: slotLevel, spellName: 'Magic Missile' }),
        userId,
      );
      expect(darts).toBe(slotLevel + 2);
    },
  );

  it.each([
    ['absent', undefined],
    ['null', null],
  ])('refuses Magic Missile when the spell slot level is %s', async (_label, slotLevel) => {
    await expect(resolveSpell('Magic Missile', slotLevel)).rejects.toThrow(
      'Spell refused: Magic Missile needs a spell slot level',
    );
    expect(applyDamage).not.toHaveBeenCalled();
    expect(useSpellSlot).not.toHaveBeenCalled();
  });

  it('refuses an unknown spell before any HP write', async () => {
    await expect(resolveSpell('Not A Spell')).rejects.toThrow(
      'Spell refused: unknown spell "Not A Spell"',
    );
    expect(applyDamage).not.toHaveBeenCalled();
  });
});
