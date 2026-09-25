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

const { CombatAttackService } = await import('../combat/combat-attack-service.js');

const encounterId = 'encounter-m4';
const userId = 'user-m4';
const casterId = 'the-apprentice-participant';
const targetId = 'flavor-elemental-participant';

// The Apprentice as run M4 played it: Human Wizard 1, INT 16, and the spell columns the premade
// seed writes (comma-joined slugs), split the way `getParticipantAbilityProfile` splits them.
const apprenticeProfile = {
  level: 1,
  className: 'Wizard',
  savingThrowProficiencies: ['int', 'wis'],
  scores: { str: 8, dex: 12, con: 12, int: 16, wis: 12, cha: 10 },
  saveBonuses: {},
  spellIds: [
    'acid-splash, chill-touch, dancing-lights',
    'alarm, burning-hands, charm-person, color-spray, comprehend-languages, detect-magic',
    'alarm, burning-hands, charm-person, color-spray',
  ]
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase()),
};

const elementalProfile = {
  level: 1,
  className: null,
  savingThrowProficiencies: [],
  scores: { dex: 10 },
  saveBonuses: {},
  spellIds: [],
};

function participants() {
  const caster = {
    id: casterId,
    name: 'The Apprentice',
    participantType: 'player',
    characterId: 'the-apprentice-character',
    armorClass: 11,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    encounter: { sessionId: 'dcd4ec5c-session', currentRound: 2 },
  };
  const target = {
    id: targetId,
    name: 'Flavor-Elemental (Corrupted)',
    participantType: 'monster',
    characterId: null,
    armorClass: 14,
    maxHp: 100,
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
    status: { currentHp: 100, isConscious: true, isDead: false },
    encounter: { sessionId: 'dcd4ec5c-session', currentRound: 2 },
  };
  return new Map([
    [casterId, { participant: caster, stats: null }],
    [targetId, { participant: target, stats: null }],
  ]);
}

function configure() {
  getCurrentTurn.mockResolvedValue({ id: casterId });
  getParticipantsWithStatsBatch.mockResolvedValue(participants());
  getParticipantAbilityProfile.mockImplementation(async (participant: { id: string }) =>
    participant.id === casterId ? apprenticeProfile : elementalProfile,
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
      return { damageDealt: damage, newCurrentHp, isConscious: newCurrentHp > 0, isDead: false };
    },
  );
}

const cast = (
  spell: { spellId?: string; spellName: string },
  slotLevel?: number | null,
  d20?: number,
) =>
  new CombatAttackService().resolveSpellAttack(
    encounterId,
    { casterId, targetIds: [targetId], ...spell, slotLevel, d20, expectedVersion: 3 },
    userId,
  );

describe('run M4 replay: The Apprentice casts her own spells (#2233)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    random.mockReset().mockReturnValue(0);
    configure();
  });

  it.each([
    ['the sheet slug', 'chill-touch'],
    ['a model snake_case id', 'chill_touch'],
    ['the display name as id', 'Chill Touch'],
    ['an id the catalog has never seen', '6f1c1e2a-0000-4000-8000-000000000000'],
  ])('proposes Chill Touch at 1d20+5 when the id is %s', async (_label, spellId) => {
    const proposal = await new CombatAttackService().proposeSpellAttack(
      encounterId,
      { casterId, targetIds: [targetId], spellId, spellName: 'Chill Touch' },
      userId,
    );
    expect(proposal).toMatchObject({
      spellId: 'chill-touch',
      spellName: 'Chill Touch',
      kind: 'attack',
      // INT 16 (+3) + proficiency (+2): the bonus the dialog shows and the engine adds.
      attackBonus: 5,
      targetAc: 14,
    });
    expect(applyDamage).not.toHaveBeenCalled();
    expect(useSpellSlot).not.toHaveBeenCalled();
  });

  it('resolves Chill Touch with the player die at +5 — not another spell, not an unarmed strike', async () => {
    const result = await cast({ spellId: 'chill_touch', spellName: 'Chill Touch' }, undefined, 12);
    expect(result.results[0]).toMatchObject({
      spellName: 'Chill Touch',
      d20: 12,
      attackBonus: 5,
      totalAttackRoll: 17,
      targetAC: 14,
      hit: true,
    });
    expect(applyDamage).toHaveBeenCalledWith(
      targetId,
      encounterId,
      expect.objectContaining({ sourceDescription: 'Chill Touch', damageType: 'necrotic' }),
      userId,
      expect.any(Object),
    );
    expect(useSpellSlot).not.toHaveBeenCalled();
  });

  it('refuses a spell that is not on her sheet by name, rather than casting something else', async () => {
    await expect(
      cast({ spellId: 'fire-bolt', spellName: 'Fire Bolt' }, undefined, 15),
    ).rejects.toThrow(
      "Spell refused: Fire Bolt is not on The Apprentice's sheet — cast a spell you know or have prepared",
    );
    expect(applyDamage).not.toHaveBeenCalled();
  });

  it('keeps Acid Splash a DEX save with no attack roll', async () => {
    const result = await cast({ spellId: 'acid-splash', spellName: 'Acid Splash' }, undefined, 18);
    expect(result.results[0]).toMatchObject({
      spellName: 'Acid Splash',
      saveAbility: 'dexterity',
      saveDC: 13,
      saved: false,
    });
    expect(result.results[0]).not.toHaveProperty('attackBonus');
    expect(result.results[0]).not.toHaveProperty('d20');
  });

  it('casts Burning Hands in combat and spends a level 1 slot', async () => {
    const result = await cast({ spellId: 'burning-hands', spellName: 'Burning Hands' }, 1);
    expect(result.results[0]).toMatchObject({
      spellName: 'Burning Hands',
      saveAbility: 'dexterity',
      saveDC: 13,
    });
    expect(useSpellSlot).toHaveBeenCalledWith(
      expect.objectContaining({ spellName: 'Burning Hands', spellLevel: 1, slotLevelUsed: 1 }),
      userId,
    );
    expect(applyDamage).toHaveBeenCalledTimes(1);
  });

  it('refuses a utility spell with a reason the player can act on', async () => {
    await expect(cast({ spellId: 'charm-person', spellName: 'Charm Person' }, 1)).rejects.toThrow(
      /Spell refused: Charm Person has no attack roll or damage the combat engine resolves — describe/,
    );
    expect(useSpellSlot).not.toHaveBeenCalled();
  });
});
