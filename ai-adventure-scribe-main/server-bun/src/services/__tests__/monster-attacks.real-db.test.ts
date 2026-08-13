/* eslint-disable max-lines -- one fixture chain (starter bible -> campaign -> character ->
   session -> encounter) shared by every assertion; splitting it would mean starting combat
   three times to make the same three points. */
/**
 * A monster fights with the numbers its stat block gives it — end to end, through the real
 * combat-start path and the real attack resolver.
 *
 * The unit tests beside `monster-attack-profile.ts` prove the catalog is parsed correctly.
 * They cannot prove the parse ever reaches an attack, and that is where every previous
 * version of this bug lived: the stat ladder had been reading hit points and armour class
 * correctly for two waves while `getEquippedWeaponProfile` quietly returned an unarmed strike
 * for the same creature, so a CR 10 golem with a correct 178 HP still swung at +2 for 1.
 *
 * So these go through `CombatEncounterService.startCombat` (which resolves and stores the
 * profile) and `combatAttackService.resolveAttack` (which reads it), and assert on the
 * engine's own `COMBAT_ATTACK_RESOLVED` telemetry — the same line a production log carries.
 *
 * Real database throughout. The profile is a jsonb column written by one service and read by
 * another; a mocked `db` returns whatever the test author assumed that round-trip does, which
 * is precisely the assumption worth testing.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaignChunks,
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
  starterCampaigns,
} from '../../../../db/schema/index';

type LogPayload = Record<string, unknown>;

const emitted: LogPayload[] = [];
const profileLogs: LogPayload[] = [];
const fallbackLogs: LogPayload[] = [];

const record = (payload: LogPayload): void => {
  if (payload.msg === 'COMBAT_ATTACK_RESOLVED') emitted.push(payload);
  if (payload.msg === 'COMBAT_MONSTER_ATTACK_PROFILE') profileLogs.push(payload);
  if (payload.msg === 'COMBAT_MONSTER_ATTACK_FALLBACK') fallbackLogs.push(payload);
};

const info = mock(record);
const warn = mock(record);

// Every export is stubbed: `mock.module` replaces the module for every importer in the run,
// so a missing child logger becomes a hard "Export named 'combatLogger' not found" in some
// unrelated file.
const stub = () => ({
  info,
  warn,
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});
mock.module('../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
}));

const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);
const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { clearCampaignMonsterCache } = await importWithRealDb(
  () => import('../combat/campaign-monster-resolution.js'),
);

if (!hasRealDb) {
  console.warn(
    '[monster-attacks] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

/**
 * The Stone Golem's printed line, quoted from `src/data/srd/monsters.json` so a drift in the
 * catalog fails these tests rather than silently changing what they assert:
 *
 *   "Melee Weapon Attack: +10 to hit, reach 5 ft., one target.
 *    Hit: 19 (3d8 + 6) bludgeoning damage."
 */
const STONE_GOLEM = {
  attackBonus: 10,
  damageDice: '3d8',
  damageBonus: 6,
  damageType: 'bludgeoning',
};

/** A bible creature in the shape bibles actually ship: HP and AC, abilities as prose. */
const GLUTEN_GOLEM_CHUNK = [
  '**Gluten Golem**',
  '',
  '**HP:** 90 **AC:** 14 **Speed:** 30ft',
  '',
  '**Abilities:** Rising Dough — the golem swells when heated.',
].join('\n');

/**
 * The same creature, but with an attack line authored. Used only for the precedence test.
 *
 * The `+` on the attack bonus is required, not decorative: `authored-stat-block-parser`
 * insists on it so that an attack line reading "Attack: slam" cannot be read as +0. A bible
 * writing a bare `7` gets no authored bonus and falls through to the derived rung — which is
 * the parser behaving correctly, and worth knowing when auditing bible coverage.
 */
const AUTHORED_ATTACKER_CHUNK = [
  '**Authored Attacker**',
  '',
  '**HP:** 90 **AC:** 14 **Speed:** 30ft',
  '**Attack Bonus:** +7',
  '**Damage:** 2d10+4 fire',
].join('\n');

/**
 * Four player characters, deliberately.
 *
 * This suite asserts that a creature swings the numbers ITS STAT BLOCK PRINTS, and every
 * published stat block is priced for a party of four (see `party-scaling.ts`). At a party of
 * four the scaling factor is 1.00 and the block is used verbatim, so the assertions below stay
 * assertions about the stat ladder rather than about the scaler. Party scaling has its own
 * suite; conflating the two would leave neither provable.
 */
const PARTY_SIZE = 4;

describeWithDb('monsters attack with their own numbers', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('monster-attack-user');
  const starterCampaignId = testId('bible');

  let campaignId: string;
  let characterId: string;
  const companionIds: string[] = [];
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  const ids: Record<string, string> = {};

  const NAMES = {
    hero: 'Attack Hero',
    stoneGolem: 'Stone Golem',
    glutenGolem: 'Gluten Golem',
    authored: 'Authored Attacker',
    improvised: 'The Doorkeeper',
  };

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: NAMES.hero, level: 3, class: 'Fighter' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      armorClass: 13,
      maxHitPoints: 400,
      currentHitPoints: 400,
      speed: 30,
    });
    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

    // The other three. They never act; they exist so the encounter's party size is four and
    // the scaler leaves every stat block exactly as its author printed it.
    for (let index = 1; index < PARTY_SIZE; index += 1) {
      const [row] = await db
        .insert(characters)
        .values({ userId, campaignId, name: `${NAMES.hero} Companion ${index}`, level: 3 })
        .returning({ id: characters.id });
      companionIds.push(row.id);
      await db.insert(characterStats).values({
        characterId: row.id,
        armorClass: 13,
        maxHitPoints: 400,
        currentHitPoints: 400,
        speed: 30,
      });
    }

    await db.insert(starterCampaigns).values({
      id: starterCampaignId,
      slug: starterCampaignId,
      title: 'Attack Fixture Bible',
      genre: ['fixture'],
      tone: ['diagnostic'],
      difficulty: 'medium',
      premise: 'A bible that exists only to be fought in.',
    });
    await db.insert(campaignChunks).values([
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: NAMES.glutenGolem,
        content: GLUTEN_GOLEM_CHUNK,
      },
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: NAMES.authored,
        content: AUTHORED_ATTACKER_CHUNK,
      },
    ]);
    // The index is memoized per campaign; a stale entry from another suite would resolve
    // against a bible this test did not write.
    clearCampaignMonsterCache();

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active', starterCampaignId })
      .returning({ id: gameSessions.id });

    const state = await CombatEncounterService.startCombat(
      sessionId,
      [
        { encounterId: '', characterId, name: NAMES.hero, initiativeModifier: 1 },
        ...companionIds.map((id, index) => ({
          encounterId: '',
          characterId: id,
          name: `${NAMES.hero} Companion ${index + 1}`,
          initiativeModifier: 0,
        })),
        {
          encounterId: '',
          name: NAMES.stoneGolem,
          monsterId: 'srd:stone-golem',
          initiativeModifier: 0,
        },
        {
          encounterId: '',
          name: NAMES.glutenGolem,
          monsterId: 'gluten_golem_01',
          initiativeModifier: 0,
        },
        {
          encounterId: '',
          name: NAMES.authored,
          monsterId: 'authored_attacker',
          initiativeModifier: 0,
        },
        // No monsterId and no bible entry: DM improvisation that resolves nowhere.
        { encounterId: '', name: NAMES.improvised, initiativeModifier: 0 },
      ] as Parameters<typeof CombatEncounterService.startCombat>[1],
      false,
      userId,
    );

    encounterId = state.encounter.id;
    const byName = new Map(
      state.participants.map((participant) => [participant.name, participant.id]),
    );
    heroId = byName.get(NAMES.hero)!;
    for (const [key, name] of Object.entries(NAMES)) ids[key] = byName.get(name)!;

    // Big enough that no sequence of attacks in this suite can end the encounter mid-run.
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 400, maxHp: 400 })
      .where(inArray(combatParticipantStatus.participantId, Object.values(ids)));
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(inArray(characters.id, [characterId, ...companionIds]));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await db.delete(starterCampaigns).where(eq(starterCampaigns.id, starterCampaignId));
    clearCampaignMonsterCache();
    await closeRealDb();
  });

  beforeEach(() => {
    emitted.length = 0;
    fallbackLogs.length = 0;
  });

  const storedProfile = async (participantId: string): Promise<LogPayload | null> => {
    const [row] = await db
      .select({ profile: combatParticipants.monsterAttack })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, participantId));
    return (row?.profile as LogPayload) ?? null;
  };

  /** One real resolution, returning the engine's own telemetry line for it. */
  const attack = async (attackerId: string, targetId: string): Promise<LogPayload> => {
    const [participant] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, attackerId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: participant.turnOrder, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });

    emitted.length = 0;
    await combatAttackService.resolveAttack(
      encounterId,
      { attackerId, targetId, expectedVersion: encounter.version, attackType: 'melee' },
      userId,
    );
    expect(emitted).toHaveLength(1);
    return emitted[0];
  };

  test('a Stone Golem swings its own catalog Slam, at the values printed in monsters.json', async () => {
    const profile = await storedProfile(ids.stoneGolem);
    expect(profile?.source).toBe('catalog');
    expect((profile?.attacks as LogPayload[])[0]).toMatchObject({
      name: 'Slam',
      attackBonus: STONE_GOLEM.attackBonus,
      damageDice: STONE_GOLEM.damageDice,
      damageBonus: STONE_GOLEM.damageBonus,
      damageType: STONE_GOLEM.damageType,
    });

    const line = await attack(ids.stoneGolem, heroId);
    expect(line.profileSource).toBe('catalog');
    expect(line.weapon).toBe('Slam');
    // The printed +10, verbatim — not rebuilt from ability modifier + proficiency, which for a
    // participant with no ability scores would have produced the +2 this wave exists to end.
    expect(line.attackBonus).toBe(STONE_GOLEM.attackBonus);
    expect(line.totalAttack).toBe(Number(line.d20) + STONE_GOLEM.attackBonus);
    if (line.outcome === 'hit' && !line.critical) {
      // 3d8+6 spans 9..30. The old generic profile could only ever produce 1.
      expect(line.damageRolled as number).toBeGreaterThanOrEqual(9);
      expect(line.damageRolled as number).toBeLessThanOrEqual(30);
    }
  });

  test('the profile resolution is logged with its rung, and names the Multiattack it cannot express', async () => {
    const logged = profileLogs.find((entry) => entry.combatantName === NAMES.stoneGolem);
    expect(logged).toBeDefined();
    expect(logged!.attackSource).toBe('catalog');
    expect(logged!.statSource).toBe('srd');
    expect(logged!.attack).toBe('Slam +10, 3d8+6 bludgeoning');
    // The shortfall is stated rather than hidden: the golem should make two slams a turn.
    expect(String(logged!.multiattackNotExpressed)).toContain('two slam attacks');
    expect(logged!.unsupportedActions).toContain('Slow (saving-throw ability)');
  });

  test('a campaign creature with HP and no attack line gets a derived attack, logged as derived', async () => {
    const profile = await storedProfile(ids.glutenGolem);
    expect(profile?.source).toBe('derived');
    // 90 authored HP sits in the DMG's CR 2 band: +3 to hit, 15-20 damage per round.
    expect(profile?.derivation).toEqual({
      fromMaxHp: 90,
      challengeRating: '2',
      damagePerRound: 17,
    });

    const line = await attack(ids.glutenGolem, heroId);
    // `derived` and not `authored`: these numbers were inferred from hit points because the
    // bible wrote none, and the telemetry has to keep that distinction visible.
    expect(line.profileSource).toBe('derived');
    expect(line.attackBonus).toBe(3);
    if (line.outcome === 'hit' && !line.critical) {
      // 5d6 spans 5..30 — a real attack, where the generic default gave exactly 1.
      expect(line.damageRolled as number).toBeGreaterThanOrEqual(5);
      expect(line.damageApplied as number).toBeGreaterThan(1);
    }

    const logged = profileLogs.find((entry) => entry.combatantName === NAMES.glutenGolem);
    expect(logged!.attackSource).toBe('derived');
    // The creature's STATS are authored while its ATTACK is inferred. Reporting one label for
    // both would claim the bible supplied an attack it never wrote.
    expect(logged!.statSource).toBe('campaign');
    expect(logged!.derivation).toMatchObject({ fromMaxHp: 90, challengeRating: '2' });
  });

  test('an authored attack line beats the derivation for the same creature', async () => {
    const profile = await storedProfile(ids.authored);
    expect(profile?.source).toBe('authored');
    expect((profile?.attacks as LogPayload[])[0]).toMatchObject({
      attackBonus: 7,
      damageDice: '2d10',
      damageBonus: 4,
      damageType: 'fire',
    });

    const line = await attack(ids.authored, heroId);
    expect(line.profileSource).toBe('authored');
    expect(line.attackBonus).toBe(7);
  });

  test('a creature that resolves nowhere falls back to generic AND says so', async () => {
    expect(await storedProfile(ids.improvised)).toBeNull();

    const line = await attack(ids.improvised, heroId);
    expect(line.profileSource).toBe('generic');
    expect(line.weapon).toBe('Unarmed Strike');
    // Correct behaviour, but it must be visible: an unresolved creature swinging 1d1 is
    // indistinguishable in play from one that simply rolled badly.
    const fallback = fallbackLogs.find((entry) => entry.combatantName === NAMES.improvised);
    expect(fallback).toBeDefined();
    expect(fallback!.hasStoredProfile).toBe(false);
    expect(String(fallback!.consequence)).toContain('Unarmed Strike');
  });

  test('player attacks are untouched by any of this', async () => {
    const line = await attack(heroId, ids.stoneGolem);
    // Still built from the character sheet: STR 16 (+3) + proficiency at level 3 (+2) = +5,
    // with a longsword's 1d8. No fixed bonus is ever set on a player weapon.
    expect(line.profileSource).toBe('character-sheet');
    expect(line.weapon).toBe('Longsword');
    expect(line.attackBonus).toBe(5);
    if (line.outcome === 'hit' && !line.critical) {
      expect(line.damageRolled as number).toBeGreaterThanOrEqual(4); // 1d8 + 3
      expect(line.damageRolled as number).toBeLessThanOrEqual(11);
    }
  });
});
