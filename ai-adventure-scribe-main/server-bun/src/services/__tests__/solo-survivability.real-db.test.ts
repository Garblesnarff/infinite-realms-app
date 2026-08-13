/* eslint-disable max-lines -- one fixture builder (bible -> campaign -> party -> session ->
   encounter -> board) shared by every assertion. Splitting it would mean standing up the same
   five-table chain in three files to make three halves of the same point. */
/**
 * Solo combat is survivable, and a fight that ends says so.
 *
 * Four things are proved here, and every one of them was false in playtest run 17:
 *
 *   1. A creature is fitted to the party actually present. The same stat block produces
 *      different hit points and different damage dice for a party of one and a party of four.
 *   2. No ordinary blow removes a character from full health. The per-hit cap catches a stat
 *      block the scaler could not tame, and announces itself when it does.
 *   3. Zero hit points is unconsciousness, not death. The encounter continues, death saving
 *      throws are rolled as the turn order reaches the downed character, and three of either
 *      kind produce the documented outcome.
 *   4. The blow that ends a fight reaches the DM. This is the one that has never once been
 *      true: engine-resolved facts were written onto the tactical map, and the map was torn
 *      down by the same call that ended the encounter, so the killing blow was structurally
 *      the one event that could never be narrated — in either direction.
 *
 * Real database throughout, and through the real intent gateway rather than the services under
 * it. The failure in (4) lives precisely in the seam between two services that a mocked `db`
 * would paper over: one writes a row, another flips a flag on it, and a third cannot find it.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
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
  tacticalMaps,
} from '../../../../db/schema/index';

type LogPayload = Record<string, unknown>;

const capLogs: LogPayload[] = [];
const deathSaveLogs: LogPayload[] = [];
const scalingLogs: LogPayload[] = [];

const record = (payload: LogPayload): void => {
  if (payload.msg === 'COMBAT_DAMAGE_CAP_APPLIED') capLogs.push(payload);
  if (payload.msg === 'COMBAT_DEATH_SAVE') deathSaveLogs.push(payload);
  if (payload.msg === 'COMBAT_PARTY_SCALING') scalingLogs.push(payload);
};

const info = mock(record);
const warn = mock(record);

// Every export is stubbed: `mock.module` replaces the module for every importer in the run,
// so a missing child logger becomes a hard "Export named 'combatLogger' not found" elsewhere.
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
const { executeCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);
const { clearCampaignMonsterCache } = await importWithRealDb(
  () => import('../combat/campaign-monster-resolution.js'),
);
const { saveTacticalMap, loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);
const { consumeDmTacticalFacts } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { MAX_SINGLE_HIT_FRACTION_OF_MAX_HP } = await importWithRealDb(
  () => import('../combat/hp-mechanics.js'),
);

if (!hasRealDb) {
  console.warn(
    '[solo-survivability] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

/**
 * A creature whose damage line is far past anything the CR table would budget for its hit
 * points. It exists to be the case the scaler cannot save the player from: 20d10 quartered is
 * still 5d10, and 5d10 against 11 hit points is a corpse. This is what the per-hit cap is for.
 */
const OVERWHELMING_CHUNK = [
  '**Overwhelming Thing**',
  '',
  '**HP:** 40 **AC:** 5 **Speed:** 30ft',
  '**Attack Bonus:** +15',
  '**Damage:** 20d10 bludgeoning',
].join('\n');

/** A bible creature in the shape bibles ship: hit points, armour class, abilities as prose. */
const DISH_CHUNK = [
  '**The Unwashed Dish**',
  '',
  '**HP:** 100 **AC:** 19 **Speed:** 20ft',
  '',
  '**Abilities:** Crusted Over — the grease has become structural.',
].join('\n');

/** A soft target the hero can fell in one blow, so a victory is reachable in one action. */
const MOTE_CHUNK = ['**Dust Mote**', '', '**HP:** 4 **AC:** 5 **Speed:** 30ft'].join('\n');

describeWithDb('solo combat is survivable and its endings are narratable', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('solo-user');
  const starterCampaignId = testId('solo-bible');
  const created = {
    campaigns: [] as string[],
    characters: [] as string[],
    sessions: [] as string[],
    encounters: [] as string[],
  };

  let campaignId = '';
  let fixtureReady = false;

  const ensureFixture = async (): Promise<void> => {
    if (fixtureReady) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('solo-camp') })
      .returning({ id: campaigns.id });
    created.campaigns.push(campaignId);

    await db.insert(starterCampaigns).values({
      id: starterCampaignId,
      slug: starterCampaignId,
      title: 'Solo Survivability Bible',
      genre: ['fixture'],
      tone: ['diagnostic'],
      difficulty: 'medium',
      premise: 'A bible that exists only to be fought in.',
    });
    await db.insert(campaignChunks).values([
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: 'The Unwashed Dish',
        content: DISH_CHUNK,
      },
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: 'Overwhelming Thing',
        content: OVERWHELMING_CHUNK,
      },
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: 'Dust Mote',
        content: MOTE_CHUNK,
      },
    ]);
    clearCampaignMonsterCache();
    fixtureReady = true;
  };

  interface Fixture {
    sessionId: string;
    encounterId: string;
    heroId: string;
    monsterIds: Record<string, string>;
  }

  /**
   * A whole encounter, from characters to a board with everyone standing on it.
   *
   * Built per test rather than shared. These tests kill people and end encounters, and a
   * shared fixture would make every assertion depend on the order the previous one left
   * things in — which is how a suite starts passing for the wrong reason.
   */
  const seedEncounter = async (options: {
    partySize: number;
    heroMaxHp: number;
    monsters: Array<{ name: string; monsterId: string }>;
  }): Promise<Fixture> => {
    await ensureFixture();
    const heroName = testId('Hero');
    const partyIds: string[] = [];
    for (let index = 0; index < options.partySize; index += 1) {
      const [row] = await db
        .insert(characters)
        .values({
          userId,
          campaignId,
          name: index === 0 ? heroName : `${heroName} Companion ${index}`,
          level: 3,
          class: 'Fighter',
        })
        .returning({ id: characters.id });
      partyIds.push(row.id);
      created.characters.push(row.id);
      await db.insert(characterStats).values({
        characterId: row.id,
        strength: 16,
        dexterity: 12,
        armorClass: 13,
        maxHitPoints: options.heroMaxHp,
        currentHitPoints: options.heroMaxHp,
        speed: 30,
      });
    }
    await db.insert(inventoryItems).values({
      characterId: partyIds[0],
      name: 'Longsword',
      itemType: 'weapon',
      isEquipped: true,
    });

    const [session] = await db
      .insert(gameSessions)
      .values({
        campaignId,
        characterId: partyIds[0],
        sessionNumber: 1,
        status: 'active',
        starterCampaignId,
      })
      .returning({ id: gameSessions.id });
    created.sessions.push(session.id);

    const state = await CombatEncounterService.startCombat(
      session.id,
      [
        ...partyIds.map((id, index) => ({
          encounterId: '',
          characterId: id,
          name: index === 0 ? heroName : `${heroName} Companion ${index}`,
          initiativeModifier: 0,
        })),
        ...options.monsters.map((monster) => ({
          encounterId: '',
          name: monster.name,
          monsterId: monster.monsterId,
          initiativeModifier: 0,
        })),
      ] as Parameters<typeof CombatEncounterService.startCombat>[1],
      false,
      userId,
    );
    created.encounters.push(state.encounter.id);

    const byName = new Map(state.participants.map((p) => [p.name, p.id]));
    const heroId = byName.get(heroName)!;
    const monsterIds = Object.fromEntries(
      options.monsters.map((monster) => [monster.name, byName.get(monster.name)!]),
    );

    // Deterministic turn order: the party first, then the monsters, in declaration order.
    // Initiative is rolled, and a suite that depended on the roll would be a suite that
    // failed one run in twenty for reasons that had nothing to do with what it asserts.
    const order = [...partyIds.map((_, index) => index), ...options.monsters.map((_, i) => i)];
    const orderedIds = [
      ...state.participants
        .filter((p) => p.participantType === 'player')
        .map((p) => p.id)
        .sort((a, b) => (a === heroId ? -1 : b === heroId ? 1 : a.localeCompare(b))),
      ...options.monsters.map((monster) => byName.get(monster.name)!),
    ];
    for (const [index, id] of orderedIds.entries()) {
      await db
        .update(combatParticipants)
        .set({ turnOrder: index })
        .where(eq(combatParticipants.id, id));
    }
    void order;

    // A board, because engine-resolved facts are recorded onto one and melee approach is
    // resolved against one. Everyone stands adjacent so no attack resolves as movement.
    await saveTacticalMap({
      id: crypto.randomUUID(),
      sessionId: session.id,
      width: 12,
      height: 5,
      cells: Array.from({ length: 5 }, () =>
        Array.from({ length: 12 }, () => ({
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        })),
      ),
      entities: orderedIds.map((id, index) => ({
        id,
        slug: `entity-${index}`,
        x: index + 1,
        y: 2,
        size: 'medium' as const,
        type: (id === heroId || partyIds.length > 1 ? 'pc' : 'monster') as 'pc' | 'monster',
        speedFeet: 30,
        movementRemaining: 30,
      })),
      round: 1,
      sceneDescription: 'solo survivability fixture',
    });

    return { sessionId: session.id, encounterId: state.encounter.id, heroId, monsterIds };
  };

  /** Hands the turn to one participant and refunds every action in the encounter. */
  const giveTurnTo = async (encounterId: string, participantId: string): Promise<void> => {
    const [participant] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, participantId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: participant.turnOrder, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
  };

  const statusOf = async (participantId: string) => {
    const [row] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    return row;
  };

  const encounterStatus = async (encounterId: string): Promise<string> => {
    const [row] = await db
      .select({ status: combatEncounters.status })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row.status;
  };

  const storedProfile = async (participantId: string) => {
    const [row] = await db
      .select({ profile: combatParticipants.monsterAttack, maxHp: combatParticipants.maxHp })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, participantId));
    return row as {
      maxHp: number;
      profile: {
        attacks: Array<{ damageDice: string; damageBonus: number }>;
        partyScaling?: { factor: number; rawMaxHp: number; partySize: number };
      } | null;
    };
  };

  /**
   * Pins `Math.random` to a constant for the duration of one call.
   *
   * Constant rather than a queue of forced faces, deliberately: the resolution path makes
   * several database round-trips before it reaches `rollD20`, postgres.js draws from
   * `Math.random` along the way, and a queued value gets eaten by a connection detail. A
   * constant cannot be consumed by the wrong caller.
   *
   *   0.9000 -> d20 19, every damage die at 90% of its face: a solid hit, not a crit
   *   0.9999 -> d20 20: a critical hit, every die maximal
   *   0.3000 -> d20  7: a death-save failure
   *   0.6000 -> d20 13: a death-save success
   */
  const withRandom = async <T>(value: number, work: () => Promise<T>): Promise<T> => {
    const original = Math.random;
    Math.random = () => value;
    try {
      return await work();
    } finally {
      Math.random = original;
    }
  };

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const sessionId of created.sessions) {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    }
    if (created.encounters.length) {
      await db
        .delete(combatParticipants)
        .where(inArray(combatParticipants.encounterId, created.encounters));
      await db.delete(combatEncounters).where(inArray(combatEncounters.id, created.encounters));
    }
    if (created.sessions.length) {
      await db.delete(gameSessions).where(inArray(gameSessions.id, created.sessions));
    }
    if (created.characters.length) {
      await db.delete(characters).where(inArray(characters.id, created.characters));
    }
    if (created.campaigns.length) {
      await db.delete(campaigns).where(inArray(campaigns.id, created.campaigns));
    }
    await db.delete(starterCampaigns).where(eq(starterCampaigns.id, starterCampaignId));
    clearCampaignMonsterCache();
    await closeRealDb();
  });

  beforeEach(() => {
    capLogs.length = 0;
    deathSaveLogs.length = 0;
    scalingLogs.length = 0;
  });

  // -------------------------------------------------------------------------------------
  // 1. Party-size scaling
  // -------------------------------------------------------------------------------------

  test('the same stat block gives a party of one and a party of four different fights', async () => {
    const solo = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'The Unwashed Dish', monsterId: 'unwashed_dish' }],
    });
    const soloDish = await storedProfile(solo.monsterIds['The Unwashed Dish']);

    const party = await seedEncounter({
      partySize: 4,
      heroMaxHp: 11,
      monsters: [{ name: 'The Unwashed Dish', monsterId: 'unwashed_dish' }],
    });
    const partyDish = await storedProfile(party.monsterIds['The Unwashed Dish']);

    // Both were resolved from the same 100 authored hit points, through the same CR band.
    expect(soloDish.profile?.partyScaling?.rawMaxHp).toBe(100);
    expect(partyDish.profile?.partyScaling?.rawMaxHp).toBe(100);

    // Hit points: quartered for one character, printed for four.
    expect(soloDish.maxHp).toBe(25);
    expect(partyDish.maxHp).toBe(100);

    // Damage: 100 HP -> CR 2 -> 17/round -> 5d6 (average 17.5) for four; a quarter of that
    // average, refitted to the same die, for one.
    expect(partyDish.profile?.attacks[0]).toMatchObject({ damageDice: '5d6', damageBonus: 0 });
    expect(soloDish.profile?.attacks[0]).toMatchObject({ damageDice: '1d6', damageBonus: 1 });

    // The maximum a solo Dish can roll is 7 against 11 hit points. In run 17 the same
    // creature landed 11, 15, 21 and a crit for 31 against the same character.
    expect(soloDish.profile?.partyScaling?.factor).toBe(0.25);
    expect(partyDish.profile?.partyScaling?.factor).toBe(1);
  });

  test('the scaling is logged whenever it changes something, and silent when it does not', async () => {
    scalingLogs.length = 0;
    await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'The Unwashed Dish', monsterId: 'unwashed_dish' }],
    });
    const soloLog = scalingLogs.find((entry) => entry.combatantName === 'The Unwashed Dish');
    expect(soloLog).toBeDefined();
    expect(soloLog!.partySize).toBe(1);
    expect(soloLog!.factor).toBe(0.25);
    expect(soloLog!.hp).toBe('100 -> 25');
    expect(soloLog!.damage).toEqual(['5d6 (avg 17.5) -> 1d6+1']);

    scalingLogs.length = 0;
    await seedEncounter({
      partySize: 4,
      heroMaxHp: 11,
      monsters: [{ name: 'The Unwashed Dish', monsterId: 'unwashed_dish' }],
    });
    // Nothing was rewritten, so nothing is claimed to have been.
    expect(scalingLogs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------------------
  // 2. The per-hit cap
  // -------------------------------------------------------------------------------------

  test('a stat block the scaler cannot tame still cannot one-shot a character from full health', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Overwhelming Thing', monsterId: 'overwhelming_thing' }],
    });
    const monsterId = fixture.monsterIds['Overwhelming Thing'];

    // Even quartered, this creature's authored 20d10 is 5d10 — well past lethal against 11.
    const profile = await storedProfile(monsterId);
    expect(profile.profile?.attacks[0].damageDice).toBe('5d10');

    await giveTurnTo(fixture.encounterId, monsterId);
    const result = (await withRandom(0.9, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: monsterId, targetId: fixture.heroId },
        userId,
        'dm',
      ),
    )) as { hit: boolean; isCritical: boolean; finalDamage: number };

    expect(result.hit).toBe(true);
    expect(result.isCritical).toBe(false);

    // Half of 11, floored: the most an ordinary hit may ever take.
    const cap = Math.floor(11 * MAX_SINGLE_HIT_FRACTION_OF_MAX_HP);
    expect(cap).toBe(5);
    expect(result.finalDamage).toBe(cap);

    const status = await statusOf(fixture.heroId);
    expect(status.currentHp).toBe(11 - cap);
    expect(status.isConscious).toBe(true);

    // And it said so. A cap that rewrites damage in silence is the same class of problem as
    // the silent stat fallbacks this codebase spent weeks removing.
    const logged = capLogs.find((entry) => entry.participantId === fixture.heroId);
    expect(logged).toBeDefined();
    expect(logged!.reason).toBe('per_hit_fraction');
    expect(logged!.cappedTo).toBe(cap);
    expect(logged!.rawDamage as number).toBeGreaterThan(cap);
    expect(logged!.fraction).toBe(MAX_SINGLE_HIT_FRACTION_OF_MAX_HP);
  });

  test('a critical hit ignores the fraction, and the worst it can do from full health is 0 HP', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Overwhelming Thing', monsterId: 'overwhelming_thing' }],
    });
    const monsterId = fixture.monsterIds['Overwhelming Thing'];

    await giveTurnTo(fixture.encounterId, monsterId);
    const result = (await withRandom(0.9999, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: monsterId, targetId: fixture.heroId },
        userId,
        'dm',
      ),
    )) as { hit: boolean; isCritical: boolean; finalDamage: number; targetIsDead: boolean };

    expect(result.hit).toBe(true);
    expect(result.isCritical).toBe(true);
    // Far more than the 5 an ordinary hit is allowed — a crit is meant to be frightening.
    expect(result.finalDamage).toBeGreaterThan(Math.floor(11 * MAX_SINGLE_HIT_FRACTION_OF_MAX_HP));
    // But clamped to exactly the hit points the character had, so a single blow can never
    // produce the overkill that instant death would require.
    expect(result.finalDamage).toBe(11);

    const status = await statusOf(fixture.heroId);
    expect(status.currentHp).toBe(0);
    expect(status.isConscious).toBe(false);
    expect(status.deathSavesFailures).toBe(0);
    expect(result.targetIsDead).toBe(false);

    const logged = capLogs.find((entry) => entry.participantId === fixture.heroId);
    expect(logged).toBeDefined();
    expect(logged!.reason).toBe('critical_overkill_from_full_hp');
    expect(logged!.cappedTo).toBe(11);
  });

  // -------------------------------------------------------------------------------------
  // 3. Death saves
  // -------------------------------------------------------------------------------------

  test('0 HP is unconscious and dying, and the encounter does not end', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Overwhelming Thing', monsterId: 'overwhelming_thing' }],
    });
    const monsterId = fixture.monsterIds['Overwhelming Thing'];

    await giveTurnTo(fixture.encounterId, monsterId);
    await withRandom(0.9999, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: monsterId, targetId: fixture.heroId },
        userId,
        'dm',
      ),
    );

    const status = await statusOf(fixture.heroId);
    expect(status.currentHp).toBe(0);
    expect(status.isConscious).toBe(false);
    expect(status.deathSavesFailures).toBe(0);
    // The whole point. Before this wave, 0 HP ended the encounter as `party_defeated` on the
    // spot and the board was torn down with a living character standing on it.
    expect(await encounterStatus(fixture.encounterId)).toBe('active');
    expect(await loadActiveTacticalMap(fixture.sessionId)).not.toBeNull();

    // And the DM is told what state the character is in, in words, not just a number.
    const facts = await consumeDmTacticalFacts(fixture.sessionId);
    expect(facts.join('\n')).toContain('UNCONSCIOUS and DYING');
    expect(facts.join('\n')).toContain('not dead');
  });

  test('three failed death saving throws kill the character and end the encounter', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Overwhelming Thing', monsterId: 'overwhelming_thing' }],
    });
    const monsterId = fixture.monsterIds['Overwhelming Thing'];

    await giveTurnTo(fixture.encounterId, monsterId);
    await withRandom(0.9999, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: monsterId, targetId: fixture.heroId },
        userId,
        'dm',
      ),
    );
    deathSaveLogs.length = 0;

    // 0.3 -> d20 7: a failure, every time. Each monster turn hands the turn on to the downed
    // character, whose turn is a death saving throw and nothing else.
    for (let round = 0; round < 3; round += 1) {
      await giveTurnTo(fixture.encounterId, monsterId);
      await withRandom(0.3, () =>
        executeCombatIntent(
          fixture.encounterId,
          { type: 'end_turn', actorId: monsterId },
          userId,
          'dm',
        ),
      );
    }

    expect(deathSaveLogs).toHaveLength(3);
    expect(deathSaveLogs.map((entry) => entry.failures)).toEqual([1, 2, 3]);
    expect(deathSaveLogs.at(-1)!.isDead).toBe(true);

    const status = await statusOf(fixture.heroId);
    expect(status.currentHp).toBe(0);
    expect(status.deathSavesFailures).toBe(3);
    expect(await encounterStatus(fixture.encounterId)).toBe('completed');
  });

  test('three successful death saving throws stabilise the character', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Overwhelming Thing', monsterId: 'overwhelming_thing' }],
    });
    const monsterId = fixture.monsterIds['Overwhelming Thing'];

    await giveTurnTo(fixture.encounterId, monsterId);
    await withRandom(0.9999, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: monsterId, targetId: fixture.heroId },
        userId,
        'dm',
      ),
    );
    deathSaveLogs.length = 0;

    // 0.6 -> d20 13: a success, every time.
    for (let round = 0; round < 3; round += 1) {
      await giveTurnTo(fixture.encounterId, monsterId);
      await withRandom(0.6, () =>
        executeCombatIntent(
          fixture.encounterId,
          { type: 'end_turn', actorId: monsterId },
          userId,
          'dm',
        ),
      );
    }

    expect(deathSaveLogs).toHaveLength(3);
    expect(deathSaveLogs.map((entry) => entry.successes)).toEqual([1, 2, 3]);
    expect(deathSaveLogs.at(-1)!.isStabilized).toBe(true);
    expect(deathSaveLogs.at(-1)!.isDead).toBe(false);

    const status = await statusOf(fixture.heroId);
    // Stable, not healed: still at 0 hit points, still unconscious, no longer dying.
    expect(status.currentHp).toBe(0);
    expect(status.isConscious).toBe(false);
    expect(status.deathSavesSuccesses).toBe(3);
    expect(status.deathSavesFailures).toBe(0);

    // Nobody on the party's side can act again under their own power, so the encounter is
    // over — as a defeat, not a death.
    expect(await encounterStatus(fixture.encounterId)).toBe('completed');
  });

  test('a natural 20 on a death save puts the character back on their feet at 1 HP', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Overwhelming Thing', monsterId: 'overwhelming_thing' }],
    });
    const monsterId = fixture.monsterIds['Overwhelming Thing'];

    await giveTurnTo(fixture.encounterId, monsterId);
    await withRandom(0.9999, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: monsterId, targetId: fixture.heroId },
        userId,
        'dm',
      ),
    );
    deathSaveLogs.length = 0;

    await giveTurnTo(fixture.encounterId, monsterId);
    await withRandom(0.9999, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'end_turn', actorId: monsterId },
        userId,
        'dm',
      ),
    );

    expect(deathSaveLogs).toHaveLength(1);
    expect(deathSaveLogs[0].wasRevived).toBe(true);
    const status = await statusOf(fixture.heroId);
    expect(status.currentHp).toBe(1);
    expect(status.isConscious).toBe(true);
    expect(await encounterStatus(fixture.encounterId)).toBe('active');
  });

  // -------------------------------------------------------------------------------------
  // 4. Endings reach the DM
  // -------------------------------------------------------------------------------------

  test('the blow that fells the last hostile survives the teardown and reaches the next context fetch', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Dust Mote', monsterId: 'dust_mote' }],
    });
    const moteId = fixture.monsterIds['Dust Mote'];

    // 4 authored hit points, quartered to 1. One longsword hit is the whole fight.
    expect((await storedProfile(moteId)).maxHp).toBe(1);

    await giveTurnTo(fixture.encounterId, fixture.heroId);
    await withRandom(0.9, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: fixture.heroId, targetId: moteId },
        userId,
        'dm',
      ),
    );

    expect(await encounterStatus(fixture.encounterId)).toBe('completed');
    // The board is gone. This is the exact condition under which every previous version of
    // this code lost the killing blow.
    expect(await loadActiveTacticalMap(fixture.sessionId)).toBeNull();

    const facts = await consumeDmTacticalFacts(fixture.sessionId);
    const text = facts.join('\n');
    expect(facts.length).toBeGreaterThan(0);
    // The blow itself...
    expect(text).toContain('Dust Mote');
    expect(text).toMatch(/HIT for \d+ damage/);
    // ...and the fact that it ended the fight, with which side won.
    expect(text).toContain('THE FIGHT IS OVER');
    expect(text).toContain('the last hostile has fallen');
  });

  test('the party going down survives the teardown too — both endings, not just the winning one', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Overwhelming Thing', monsterId: 'overwhelming_thing' }],
    });
    const monsterId = fixture.monsterIds['Overwhelming Thing'];

    await giveTurnTo(fixture.encounterId, monsterId);
    await withRandom(0.9999, () =>
      executeCombatIntent(
        fixture.encounterId,
        { type: 'attack', actorId: monsterId, targetId: fixture.heroId },
        userId,
        'dm',
      ),
    );
    for (let round = 0; round < 3; round += 1) {
      await giveTurnTo(fixture.encounterId, monsterId);
      await withRandom(0.3, () =>
        executeCombatIntent(
          fixture.encounterId,
          { type: 'end_turn', actorId: monsterId },
          userId,
          'dm',
        ),
      );
    }

    expect(await encounterStatus(fixture.encounterId)).toBe('completed');
    expect(await loadActiveTacticalMap(fixture.sessionId)).toBeNull();

    const text = (await consumeDmTacticalFacts(fixture.sessionId)).join('\n');
    expect(text).toContain('UNCONSCIOUS and DYING');
    expect(text).toContain('their third failure');
    expect(text).toContain('is DEAD');
    expect(text).toContain('THE FIGHT IS OVER');
    expect(text).toContain('no member of the party is still able to fight');
  });

  test('consuming facts clears them, so the DM is never handed the same ending twice', async () => {
    const fixture = await seedEncounter({
      partySize: 1,
      heroMaxHp: 11,
      monsters: [{ name: 'Dust Mote', monsterId: 'dust_mote' }],
    });
    await giveTurnTo(fixture.encounterId, fixture.heroId);
    await withRandom(0.9, () =>
      executeCombatIntent(
        fixture.encounterId,
        {
          type: 'attack',
          actorId: fixture.heroId,
          targetId: fixture.monsterIds['Dust Mote'],
        },
        userId,
        'dm',
      ),
    );

    expect((await consumeDmTacticalFacts(fixture.sessionId)).length).toBeGreaterThan(0);
    expect(await consumeDmTacticalFacts(fixture.sessionId)).toEqual([]);
  });
});
