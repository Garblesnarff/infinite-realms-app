/**
 * Playtest run 16 regression: nine encounters in one three-minute session.
 *
 * What was happening, mechanically. `endCombatIfResolved` runs after every damaging action
 * and asks "are both sides still standing?" as `livingTypes.has('player') &&
 * livingTypes.has('npc')`. But `combat_participants.participant_type` carries four values,
 * and `startCombat` stamps a DM-authored combatant `'monster'` (with an SRD id) or `'other'`
 * (without one) — `'npc'` only ever comes from an `npcId`, a database NPC row that
 * structured combat starts never supply. So no structured encounter has ever contained a
 * living `'npc'`, the test was false from the first landed hit onward, and every damaging
 * action ended the fight and tore down the tactical map with the enemy still up. Run 16's
 * monster finished at 2/11 HP in an encounter the engine had already closed. The DM, reading
 * a session that was correctly no longer in combat, started a new one; the next hit ended
 * that one too; nine times over.
 *
 * These tests pin both halves: an encounter with a living hostile survives a landed hit, and
 * a session already in combat does not get a second encounter.
 *
 * Real database, not a mock: the bug is in a query result's *values*, and a mocked `db`
 * returns whatever the test author expected those values to be.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  characterFeatures,
  characterStats,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../db/schema/index';

const { executeCombatIntent, getLegalCombatActions } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);
const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);
const { RestService } = await importWithRealDb(() => import('../rest-service.js'));
const { withPreservedActionSurgeMark, armActionSurge, clearActionSurgeMark, readActionSurgeMark } =
  await importWithRealDb(() => import('../combat/combat-turn-resources.js'));
const { SessionService } = await importWithRealDb(() => import('../session-service.js'));

if (!hasRealDb) {
  console.warn(
    '[encounter-lifecycle] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('an encounter survives a landed hit while a hostile is still standing', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('lifecycle-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let monsterId: string;

  const MONSTER_HP = 200;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: 5, class: 'Fighter' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 20,
      armorClass: 15,
      maxHitPoints: 50,
      currentHitPoints: 50,
      speed: 30,
    });

    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Lifecycle Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 50,
          speed: 30,
        },
        {
          encounterId,
          name: 'Lifecycle Golem',
          // The value the old check could not see. Everything below turns on this string.
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          // AC 1: the hit must land, because the bug only fires on a damaging action.
          armorClass: 1,
          maxHp: MONSTER_HP,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    monsterId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 50, maxHp: 50, isConscious: true },
      {
        participantId: monsterId,
        currentHp: MONSTER_HP,
        maxHp: MONSTER_HP,
        isConscious: true,
      },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  const statusOf = async (participantId: string): Promise<number> => {
    const [row] = await db
      .select({ hp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    return row.hp;
  };

  const encounterStatus = async (): Promise<string> => {
    const [row] = await db
      .select({ status: combatEncounters.status })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row.status;
  };

  const heroAttacks = async () => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
    return executeCombatIntent(
      encounterId,
      { type: 'attack', actorId: heroId, targetId: monsterId },
      userId,
      'dm',
    );
  };

  /**
   * Attacks until damage actually lands.
   *
   * The monster's AC is 1, so the only way to miss is a natural 1 — but a natural 1 always
   * misses regardless of AC, which makes a single attack a 5% coin flip. Every assertion in
   * this suite is about what happens *after* damage is applied, so a missed attack tests
   * nothing and fails for a reason unrelated to the behaviour under test.
   *
   * This was latent from the moment the suite was written and surfaced when an unrelated new
   * suite shifted the shared `Math.random` stream. Bounded at twelve: the odds of twelve
   * consecutive natural 1s are 1 in 20^12.
   */
  const heroAttacksUntilDamage = async (): Promise<void> => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const before = await statusOf(monsterId);
      await heroAttacks();
      if ((await statusOf(monsterId)) < before) return;
    }
    throw new Error('twelve consecutive misses against AC 1 — the dice are not the problem');
  };

  test('a landed hit on a living monster does not end the encounter', async () => {
    expect(await encounterStatus()).toBe('active');

    await heroAttacksUntilDamage();

    const hpAfter = await statusOf(monsterId);
    // Precondition for the assertion that follows: damage really did land, so the
    // end-of-combat check really did run. Without this a passing test could mean nothing
    // more than "the attack missed".
    expect(hpAfter).toBeLessThan(MONSTER_HP);
    expect(hpAfter).toBeGreaterThan(0);

    // The regression itself. Before the fix this read 'completed' with the monster on
    // ~190 HP, the tactical map was destroyed, and the DM restarted combat next turn.
    expect(await encounterStatus()).toBe('active');
  });

  test('the encounter is still the active one for the session, so no second one is created', async () => {
    // The server's combat-start endpoint is idempotent *against an active encounter*
    // (initiative.ts returns `alreadyActive` rather than inserting). That guard was never
    // the problem: it was never reached, because by the time the DM asked again there was
    // genuinely no active encounter to find. This asserts the guard's precondition holds.
    const active = await CombatEncounterService.getActiveEncounter(sessionId, userId);
    expect(active?.id).toBe(encounterId);
  });

  test('combat still ends when the last hostile actually goes down', async () => {
    // The fix must not make encounters immortal. Drop the monster and confirm the same
    // check closes the fight.
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 1 })
      .where(eq(combatParticipantStatus.participantId, monsterId));

    await heroAttacksUntilDamage();

    expect(await statusOf(monsterId)).toBe(0);
    expect(await encounterStatus()).toBe('completed');
    expect(await CombatEncounterService.getActiveEncounter(sessionId, userId)).toBeUndefined();
  });
});

/**
 * #975: Second Wind and Action Surge are engine actions, not DM prose.
 *
 * Hark N21-021: a Fighter at 1 HP typed "Second Wind" and got "That action is
 * not supported yet"; "I use Action Surge..." got "That was not a combat
 * action". Both features already live on the sheet — `character_features`
 * rows granted from `class_features_library` (Second Wind at level 1, Action
 * Surge at level 2, one use per short rest) — but the combat-intent vocabulary
 * had no word for either, so nothing could spend them.
 *
 * The fixture is a level-1 Fighter built the way the suites above build
 * combatants (direct inserts copying the producers' output). The feature
 * rows copy the grant producer's exact insert (`ClassFeaturesService`
 * grantFeature: `usesRemaining = usesCount`, `isActive`, `acquiredAtLevel`):
 * Second Wind as the level-1 grant writes it, Action Surge as the level-2
 * grant writes it — the character stays level 1 so the Second Wind heal is
 * pinned at 1d10 + 1. On main before the fix, both intents fall through the
 * dispatch and every assertion below about healing, uses and extra actions
 * fails.
 */
describeWithDb('fighter features resolve as combat intents (#975)', () => {
  // Bound in beforeAll, not at definition time: the describe above closes the
  // shared client in its afterAll, so an instance captured here would be ended
  // before this block's first query.
  let db: ReturnType<typeof realDb>;
  const userId = testId('fighter-user');

  const MAX_HP = 12;

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let monsterId: string;

  beforeAll(async () => {
    db = realDb();
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('fighter'),
        level: 1,
        class: 'Fighter',
        classLevels: [{ className: 'Fighter', level: 1 }],
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      armorClass: 15,
      maxHitPoints: MAX_HP,
      currentHitPoints: MAX_HP,
      speed: 30,
    });

    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

    // The grant producer's row shape, from the seeded library rows.
    const library = await db
      .select()
      .from(classFeaturesLibrary)
      .where(eq(classFeaturesLibrary.className, 'Fighter'));
    const secondWind = library.find((row) => row.featureName === 'Second Wind');
    const actionSurge = library.find((row) => row.featureName === 'Action Surge');
    if (!secondWind || !actionSurge) throw new Error('Fighter library rows not seeded');
    await db.insert(characterFeatures).values([
      {
        characterId,
        featureId: secondWind.id,
        usesRemaining: secondWind.usesCount,
        isActive: true,
        acquiredAtLevel: 1,
      },
      {
        characterId,
        featureId: actionSurge.id,
        usesRemaining: actionSurge.usesCount,
        isActive: true,
        acquiredAtLevel: 2,
      },
    ]);

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Fighter Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: MAX_HP,
          speed: 30,
        },
        {
          encounterId,
          name: 'Training Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 200,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    monsterId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: MAX_HP, maxHp: MAX_HP, isConscious: true },
      { participantId: monsterId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  const heroStatusHp = async (): Promise<number> => {
    const [row] = await db
      .select({ hp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, heroId));
    return row.hp;
  };

  const sheetHp = async (): Promise<number> => {
    const [row] = await db
      .select({ hp: characterStats.currentHitPoints })
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    return row.hp;
  };

  const setHeroHp = async (hp: number): Promise<void> => {
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: hp, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, heroId));
    await db
      .update(characterStats)
      .set({ currentHitPoints: hp })
      .where(eq(characterStats.characterId, characterId));
  };

  const usesOf = async (featureName: string): Promise<number | null> => {
    const [row] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(classFeaturesLibrary.featureName, featureName),
        ),
      );
    return row?.usesRemaining ?? null;
  };

  const setUses = async (featureName: string, uses: number): Promise<void> => {
    const [libraryRow] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(eq(classFeaturesLibrary.featureName, featureName));
    await db
      .update(characterFeatures)
      .set({ usesRemaining: uses })
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, libraryRow.id),
        ),
      );
  };

  const heroResources = async () => {
    const [row] = await db
      .select({
        actionUsed: combatParticipants.actionUsed,
        bonusActionUsed: combatParticipants.bonusActionUsed,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    return row;
  };

  /** The hero holds the turn again with a fresh action and bonus action. */
  const resetTurn = async (): Promise<void> => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, currentRound: 1, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
  };

  const expectRefusal = async (run: Promise<unknown>, pattern: RegExp): Promise<void> => {
    let message: string | null = null;
    try {
      await run;
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBeNull();
    expect(message!).toMatch(pattern);
  };

  const heroAttacks = () =>
    executeCombatIntent(
      encounterId,
      { type: 'attack', actorId: heroId, targetId: monsterId },
      userId,
      'dm',
    );

  test('Second Wind heals 1d10 + fighter level through the participant and the sheet', async () => {
    await resetTurn();
    await setHeroHp(3);
    expect(await usesOf('Second Wind')).toBe(1);

    const result = (await executeCombatIntent(
      encounterId,
      { type: 'second_wind', actorId: heroId },
      userId,
      'dm',
    )) as {
      applied?: boolean;
      roll?: number;
      healed?: number;
      newHp?: number;
      usesRemaining?: number;
    };

    expect(result.applied).toBe(true);
    // The formula pinned exactly, not probabilistically: healed is the rolled
    // d10 + fighter level 1, clamped at max HP (from 3 HP, at most 9 lands).
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(10);
    expect(result.healed).toBe(Math.min((result.roll ?? 0) + 1, MAX_HP - 3));
    expect(result.newHp).toBe(3 + (result.healed ?? 0));
    expect(result.newHp).toBeLessThanOrEqual(MAX_HP);
    expect(result.usesRemaining).toBe(0);
    // The participant and the sheet move together (the HP write-through).
    const newHp = result.newHp ?? -1;
    expect(await heroStatusHp()).toBe(newHp);
    expect(await sheetHp()).toBe(newHp);
    expect(await usesOf('Second Wind')).toBe(0);
    // A bonus action: spent, and the action itself is untouched; the turn
    // has not advanced to the monster.
    const resources = await heroResources();
    expect(resources.bonusActionUsed).toBe(true);
    expect(resources.actionUsed).toBe(false);
  });

  test('Second Wind refuses a second use before a short rest and spends nothing', async () => {
    // Pin the state instead of inheriting the heal test's dice: at full
    // health the resolver's full-health refusal fires first (it is checked
    // before the spend), so the hero must be hurt with the use already gone
    // for the no-uses refusal to be the one under test. (CI's roll capped
    // the heal at full HP and this test read the wrong refusal.)
    await setHeroHp(5);
    await setUses('Second Wind', 0);
    const hpBefore = await heroStatusHp();
    await resetTurn();
    expect(await usesOf('Second Wind')).toBe(0);

    await expectRefusal(
      executeCombatIntent(encounterId, { type: 'second_wind', actorId: heroId }, userId, 'dm'),
      /Second Wind/,
    );

    expect(await heroStatusHp()).toBe(hpBefore);
    expect(await usesOf('Second Wind')).toBe(0);
    // The refused claim gave the bonus action back.
    expect((await heroResources()).bonusActionUsed).toBe(false);
  });

  test('a short rest restores Second Wind, and the restored use resolves', async () => {
    await RestService.takeShortRest(characterId, userId, 0);
    expect(await usesOf('Second Wind')).toBe(1);

    await resetTurn();
    await setHeroHp(5);
    const result = (await executeCombatIntent(
      encounterId,
      { type: 'second_wind', actorId: heroId },
      userId,
      'dm',
    )) as { applied?: boolean; healed?: number };
    expect(result.applied).toBe(true);
    expect(result.healed).toBeGreaterThan(0);
    expect(await usesOf('Second Wind')).toBe(0);
  });

  test('a long rest also restores both features (2014 PHB: short or long rest)', async () => {
    await setUses('Second Wind', 0);
    await setUses('Action Surge', 0);
    await RestService.takeLongRest(characterId, userId);
    expect(await usesOf('Second Wind')).toBe(1);
    expect(await usesOf('Action Surge')).toBe(1);
  });

  test('Action Surge refunds a spent action: attack, surge, attack again', async () => {
    await setUses('Action Surge', 1);
    await resetTurn();

    await heroAttacks();
    expect((await heroResources()).actionUsed).toBe(true);
    await expectRefusal(heroAttacks(), /Action already used/);

    const result = (await executeCombatIntent(
      encounterId,
      { type: 'action_surge', actorId: heroId },
      userId,
      'dm',
    )) as { applied?: boolean; usesRemaining?: number };
    expect(result.applied).toBe(true);
    expect(result.usesRemaining).toBe(0);
    expect(await usesOf('Action Surge')).toBe(0);
    expect((await heroResources()).actionUsed).toBe(false);

    // The extra action is real: another attack resolves on the same turn.
    await heroAttacks();
    expect((await heroResources()).actionUsed).toBe(true);
  });

  test('Action Surge declared first arms the extra action for the same turn', async () => {
    await setUses('Action Surge', 1);
    await resetTurn();
    expect((await heroResources()).actionUsed).toBe(false);

    const result = (await executeCombatIntent(
      encounterId,
      { type: 'action_surge', actorId: heroId },
      userId,
      'dm',
    )) as { applied?: boolean; extraActionArmed?: boolean };
    expect(result.applied).toBe(true);
    expect(result.extraActionArmed).toBe(true);

    // The armed surge is persisted where a reconnect would find it.
    const [session] = await db
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    const armed = (session.state as { actionSurgeArmed?: unknown } | null)?.actionSurgeArmed;
    expect(armed).toBeTruthy();

    await heroAttacks();
    expect((await heroResources()).actionUsed).toBe(true);
    // The second action is the surge's: it resolves, and the mark is spent.
    await heroAttacks();
    const [sessionAfter] = await db
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    expect(
      (sessionAfter.state as { actionSurgeArmed?: unknown } | null)?.actionSurgeArmed ?? null,
    ).toBeNull();
    // And there is no third action hiding behind it.
    await expectRefusal(heroAttacks(), /Action already used/);
  });

  test('Second Wind is refused at full health and spends nothing', async () => {
    await setUses('Second Wind', 1);
    await setHeroHp(MAX_HP);
    await resetTurn();

    await expectRefusal(
      executeCombatIntent(encounterId, { type: 'second_wind', actorId: heroId }, userId, 'dm'),
      /full health/,
    );

    expect(await usesOf('Second Wind')).toBe(1);
    expect(await heroStatusHp()).toBe(MAX_HP);
    // The refused claim gave the bonus action back.
    expect((await heroResources()).bonusActionUsed).toBe(false);
  });

  test('Action Surge refuses a second use before a short rest', async () => {
    await setUses('Action Surge', 1);
    await resetTurn();

    await heroAttacks();
    const surged = (await executeCombatIntent(
      encounterId,
      { type: 'action_surge', actorId: heroId },
      userId,
      'dm',
    )) as { applied?: boolean };
    expect(surged.applied).toBe(true);
    await heroAttacks();
    expect(await usesOf('Action Surge')).toBe(0);

    // A fresh turn does not mint a new use: the second declaration is refused
    // and the turn's resources are exactly where the refusal found them.
    await resetTurn();
    await expectRefusal(
      executeCombatIntent(encounterId, { type: 'action_surge', actorId: heroId }, userId, 'dm'),
      /Action Surge/,
    );
    expect(await usesOf('Action Surge')).toBe(0);
    const resources = await heroResources();
    expect(resources.actionUsed).toBe(false);
    expect(resources.bonusActionUsed).toBe(false);
  });

  test('a feature declaration with a DM origin and no player input is refused', async () => {
    await setUses('Second Wind', 1);
    await setHeroHp(4);
    await resetTurn();

    // The features are in PLAYER_ORIGIN_GUARDED_TYPES: a DM- or repair-produced
    // declaration must not burn a player's tracked use. Origin 'dm' with no
    // player words is exactly that case.
    await expectRefusal(
      executeCombatIntent(
        encounterId,
        { type: 'second_wind', actorId: heroId },
        userId,
        'dm',
        undefined,
        'dm',
      ),
      /did not declare it/,
    );
    expect(await usesOf('Second Wind')).toBe(1);
    expect(await heroStatusHp()).toBe(4);
  });

  test('the legal-action list offers the features only while they can resolve', async () => {
    const offeredTypes = async (): Promise<Array<string>> => {
      const legal = await getLegalCombatActions(encounterId, userId);
      return legal.actions.map((action) => String(action.type));
    };

    await setUses('Second Wind', 1);
    await setUses('Action Surge', 1);
    await setHeroHp(5);
    await resetTurn();
    let offered = await offeredTypes();
    expect(offered).toContain('second_wind');
    expect(offered).toContain('action_surge');

    // Full health: Second Wind can only refuse, so it is not offered; Action
    // Surge still is.
    await setHeroHp(MAX_HP);
    offered = await offeredTypes();
    expect(offered).not.toContain('second_wind');
    expect(offered).toContain('action_surge');

    // Bonus action spent: no Second Wind chip even while hurt.
    await setHeroHp(5);
    await db
      .update(combatParticipants)
      .set({ bonusActionUsed: true })
      .where(eq(combatParticipants.id, heroId));
    offered = await offeredTypes();
    expect(offered).not.toContain('second_wind');
    await resetTurn();

    // No uses left: neither chip.
    await setUses('Second Wind', 0);
    await setUses('Action Surge', 0);
    offered = await offeredTypes();
    expect(offered).not.toContain('second_wind');
    expect(offered).not.toContain('action_surge');
  });

  test('a stale whole-blob session write can neither delete nor resurrect the armed surge', async () => {
    // The client's session_state writes replace the whole blob from a snapshot
    // it read earlier. SessionService.updateSession merges a client write so
    // the engine-owned key follows the stored value, not the snapshot;
    // withPreservedActionSurgeMark is that merge in JS (the service folds the
    // same merge into its UPDATE — the next test races the real service).
    // This simulates that route write at the merge, in both orders.
    const writeClientSnapshot = async (snapshot: Record<string, unknown>): Promise<void> => {
      const [current] = await db
        .select({ state: gameSessions.sessionState })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId));
      await db
        .update(gameSessions)
        .set({ sessionState: withPreservedActionSurgeMark(snapshot, current.state) })
        .where(eq(gameSessions.id, sessionId));
    };
    const storedMark = async (): Promise<unknown> => {
      const [session] = await db
        .select({ state: gameSessions.sessionState })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId));
      return (session.state as { actionSurgeArmed?: unknown } | null)?.actionSurgeArmed ?? null;
    };

    await setUses('Action Surge', 1);
    await db
      .update(gameSessions)
      .set({ sessionState: {} })
      .where(eq(gameSessions.id, sessionId));
    await resetTurn();

    const surged = (await executeCombatIntent(
      encounterId,
      { type: 'action_surge', actorId: heroId },
      userId,
      'dm',
    )) as { applied?: boolean; extraActionArmed?: boolean };
    expect(surged.applied).toBe(true);
    expect(surged.extraActionArmed).toBe(true);
    const liveMark = (await storedMark()) as Record<string, unknown>;
    expect(liveMark).toBeTruthy();

    // A snapshot read BEFORE the arm (no mark in it) lands now: the mark survives.
    await writeClientSnapshot({ clientKey: 'stale' });
    expect(await storedMark()).toEqual(liveMark);

    await heroAttacks();
    // The second action spends the mark on the claim's failure path.
    await heroAttacks();
    expect(await storedMark()).toBeNull();

    // A snapshot read WHILE armed (mark in it) lands now: nothing resurrects.
    await writeClientSnapshot({ actionSurgeArmed: liveMark, clientKey: 'stale' });
    expect(await storedMark()).toBeNull();
    await expectRefusal(heroAttacks(), /Action already used/);
  });

  test('updateSession is a single statement: a racing arm is never lost, a racing clear never resurrected', async () => {
    // Round 4 (strategist): SessionService.updateSession used to SELECT the
    // stored blob and UPDATE the merged one as two statements, so an arm or
    // a consume committing between them was undone by the write — the arm
    // dropped (use spent, no extra action) or the consume resurrected (a
    // third action). The merge is now folded into the UPDATE itself, so
    // statement order alone decides the outcome and every interleaving is
    // safe. Race the real service against the real mark writers and pin both
    // invariants on every round (the sequential case above cannot reach the
    // window; the clear stands in for the consume, which deletes the key
    // with the same single-statement UPDATE inside the claim transaction).
    const mark = { encounterId, participantId: heroId, round: 1 };
    for (let round = 0; round < 25; round++) {
      await db
        .update(gameSessions)
        .set({ sessionState: {} })
        .where(eq(gameSessions.id, sessionId));
      await Promise.all([
        SessionService.updateSession(sessionId, userId, {
          sessionState: { clientKey: 'concurrent' },
        }),
        armActionSurge(sessionId, mark),
      ]);
      expect(await readActionSurgeMark(sessionId)).toEqual(mark);

      await Promise.all([
        SessionService.updateSession(sessionId, userId, {
          sessionState: { actionSurgeArmed: mark, clientKey: 'concurrent' },
        }),
        clearActionSurgeMark(sessionId, heroId),
      ]);
      expect(await readActionSurgeMark(sessionId)).toBeNull();
    }
    await db
      .update(gameSessions)
      .set({ sessionState: {} })
      .where(eq(gameSessions.id, sessionId));
  });

  test('Action Surge is refused when the sheet has no such feature row to spend', async () => {
    await resetTurn();
    const [libraryRow] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(eq(classFeaturesLibrary.featureName, 'Action Surge'));
    await db
      .delete(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, libraryRow.id),
        ),
      );

    await expectRefusal(
      executeCombatIntent(encounterId, { type: 'action_surge', actorId: heroId }, userId, 'dm'),
      /Action Surge/,
    );
    expect((await heroResources()).actionUsed).toBe(false);
  });
});
