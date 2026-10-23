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
  dialogueHistory,
  gameSessions,
  inventoryItems,
  tacticalMaps,
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
const { resolveCombatSecondWind } = await importWithRealDb(
  () => import('../dm/combat-second-wind.js'),
);
const { resetTacticalMovementForTurn } = await importWithRealDb(
  () => import('../combat/tactical-combat-lifecycle.js'),
);
const { loadActiveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);

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

/**
 * #259: a melee attacker closes the gap and the attack is rolled.
 *
 * The original report (Hark CB-019/021/022/023): a Speed 30 ft melee character
 * told to attack a target 10–55 ft away got "could not move closer… no attack
 * was rolled" every turn, enemies only moved, and the turn could dead-end with
 * zero legal actions. The D5-021 reopen added the obstructed shape: two sides
 * across an impassable rift, neither ever able to hit the other.
 *
 * This block is the shipped form of the verification Lane B ran ad hoc in the
 * 2026-10-21 night sprint (8 scenarios green at ace6cf23, re-run here at the
 * pin's base). It exists because the 2026-10-12 verification on #259 cited a
 * describe block with this name in this file that was not present at the cited
 * ref or on main — coverage that lives only in a comment is how the issue was
 * closed twice and reopened twice. Everything goes through
 * `executeCombatIntent`, the gateway the player route and the NPC turn runner
 * both enter, against a real `tactical_maps` row per fight.
 */
describeWithDb('a melee attacker closes the gap and the attack is rolled (#259)', () => {
  // Bound per test, not at definition time: the describes above close the
  // shared client in their afterAll (see the #975 block's note).
  let db: ReturnType<typeof realDb>;

  type Pt = { x: number; y: number };
  type Blocked = Pt & { terrain: 'pit' | 'wall'; decoration: string };

  const floorCell = () => ({
    terrain: 'floor' as const,
    blocksMovement: false,
    blocksSight: false,
    cover: 0 as const,
    elevation: 0,
  });

  interface Fight {
    userId: string;
    sessionId: string;
    encounterId: string;
    heroId: string;
    foeId: string;
    cleanup: () => Promise<void>;
  }

  async function seedFight(opts: {
    width: number;
    height: number;
    hero: Pt;
    foe: Pt;
    blocked?: Blocked[];
    foeName?: string;
    foeSize?: 'medium' | 'large';
  }): Promise<Fight> {
    const userId = testId('pin259-user');
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: 1, class: 'Fighter' })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 18,
      dexterity: 14,
      armorClass: 15,
      maxHitPoints: 50,
      currentHitPoints: 50,
      speed: 30,
    });
    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Pin Fighter',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 50,
          speed: 30,
        },
        {
          encounterId,
          name: opts.foeName ?? 'Pin Goblin',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const heroId = inserted.find((r) => r.turnOrder === 0)!.id;
    const foeId = inserted.find((r) => r.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 50, maxHp: 50, isConscious: true },
      { participantId: foeId, currentHp: 30, maxHp: 30, isConscious: true },
    ]);

    const cells = Array.from({ length: opts.height }, (_, y) =>
      Array.from({ length: opts.width }, (_, x) => {
        const b = opts.blocked?.find((c) => c.x === x && c.y === y);
        if (!b) return floorCell();
        return {
          terrain: b.terrain,
          blocksMovement: true,
          blocksSight: b.terrain === 'wall',
          cover: b.terrain === 'wall' ? (3 as const) : (1 as const),
          elevation: 0,
          decoration: b.decoration,
        };
      }),
    );
    // Fixture note: production boards (generateMap) ring the edges with wall
    // cells; these boards are floor to the edge. Every start position here is
    // interior and the rift spans the full height, so no scenario can use an
    // edge route production would wall off — but a future scenario copied
    // from this helper should not assume edge routes exist in production.
    // The map row id and state.id are kept equal, as saveTacticalMap writes them.
    const mapId = crypto.randomUUID();
    const map = {
      id: mapId,
      sessionId,
      width: opts.width,
      height: opts.height,
      cells,
      entities: [
        {
          id: heroId,
          x: opts.hero.x,
          y: opts.hero.y,
          size: 'medium' as const,
          type: 'pc' as const,
          speedFeet: 30,
          movementRemaining: 30,
          name: 'Pin Fighter',
        },
        {
          id: foeId,
          x: opts.foe.x,
          y: opts.foe.y,
          size: (opts.foeSize ?? 'medium') as 'medium' | 'large',
          type: 'monster' as const,
          speedFeet: 30,
          movementRemaining: 30,
          name: opts.foeName ?? 'Pin Goblin',
        },
      ],
      round: 1,
      sceneDescription: 'pin-259',
    };
    await db.insert(tacticalMaps).values({ id: mapId, sessionId, state: map, active: true });

    return {
      userId,
      sessionId,
      encounterId,
      heroId,
      foeId,
      cleanup: async () => {
        await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
        await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
        await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
        await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
        await db.delete(characters).where(eq(characters.id, characterId));
        await db.delete(campaigns).where(eq(campaigns.id, campaignId));
      },
    };
  }

  async function setTurn(f: Fight, order: number): Promise<void> {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, f.encounterId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: order, updatedAt: new Date() })
      .where(eq(combatEncounters.id, f.encounterId));
  }

  async function entityAt(
    f: Fight,
    participantId: string,
  ): Promise<Pt & { movementRemaining: number }> {
    const map = await loadActiveTacticalMap(f.sessionId);
    const e = map!.entities.find((ent) => ent.id === participantId)!;
    return { x: e.x, y: e.y, movementRemaining: e.movementRemaining };
  }

  const distFt = (a: Pt, b: Pt) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;

  function attack(f: Fight, actorId: string, targetId: string) {
    return executeCombatIntent(
      f.encounterId,
      { type: 'attack', actorId, targetId },
      f.userId,
      'dm',
    ) as Promise<Record<string, unknown>>;
  }

  const fights: Fight[] = [];
  const seed = async (opts: Parameters<typeof seedFight>[0]): Promise<Fight> => {
    const f = await seedFight(opts);
    fights.push(f);
    return f;
  };

  beforeAll(() => {
    db = realDb();
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    for (const f of fights) await f.cleanup();
    await closeRealDb();
  });

  test('open board, 25 ft: the player attack closes the gap and rolls (CB-019/CB-021)', async () => {
    const f = await seed({ width: 12, height: 12, hero: { x: 2, y: 6 }, foe: { x: 7, y: 6 } });
    const r = await attack(f, f.heroId, f.foeId);
    expect(r.resolvedAs).not.toBe('movement_only');
    expect(typeof r.d20).toBe('number');
    expect(r.d20 as number).toBeGreaterThanOrEqual(1);
    expect(r.d20 as number).toBeLessThanOrEqual(20);
    expect(typeof r.hit).toBe('boolean');
    expect(distFt(await entityAt(f, f.heroId), await entityAt(f, f.foeId))).toBe(5);
  });

  test('open board, 25 ft: the enemy attack closes the gap and rolls (CB-022)', async () => {
    const f = await seed({ width: 12, height: 12, hero: { x: 2, y: 6 }, foe: { x: 7, y: 6 } });
    await setTurn(f, 1);
    const r = await attack(f, f.foeId, f.heroId);
    expect(r.resolvedAs).not.toBe('movement_only');
    expect(typeof r.d20).toBe('number');
    expect(typeof r.hit).toBe('boolean');
    expect(distFt(await entityAt(f, f.heroId), await entityAt(f, f.foeId))).toBe(5);
  });

  test('open board, 35 ft: 30 ft of speed ends exactly at reach and the attack rolls', async () => {
    const f = await seed({ width: 14, height: 12, hero: { x: 2, y: 6 }, foe: { x: 9, y: 6 } });
    const r = await attack(f, f.heroId, f.foeId);
    expect(r.resolvedAs).not.toBe('movement_only');
    expect(typeof r.d20).toBe('number');
    expect(typeof r.hit).toBe('boolean');
    expect(distFt(await entityAt(f, f.heroId), await entityAt(f, f.foeId))).toBe(5);
    // Every reaching cell from x=2 is 6 steps away, so the full 30 ft is spent.
    expect((await entityAt(f, f.heroId)).movementRemaining).toBe(0);
  });

  test('open board, 55 ft: movement commits, the turn is not a dead end, next turn closes and rolls (CB-023)', async () => {
    const f = await seed({ width: 18, height: 12, hero: { x: 2, y: 6 }, foe: { x: 13, y: 6 } });
    const r1 = await attack(f, f.heroId, f.foeId);
    expect(r1.resolvedAs).toBe('movement_only');
    expect(r1.movedFeet).toBe(30);
    expect(r1.distanceFeet).toBe(25);
    // CB-023: a turn that cannot reach must still offer legal actions.
    const legal = await getLegalCombatActions(f.encounterId, f.userId);
    expect(legal.actions.length).toBeGreaterThan(0);
    expect(legal.actions.map((a) => String(a.type))).toContain('end_turn');
    // The loop guard CB-023 actually turns on: with movement exhausted and the
    // target still out of reach, no 'attack (move closer first)' is offered.
    expect(legal.actions.map((a) => String(a.type))).not.toContain('attack');
    // Next turn: production movement reset, the remaining 25 ft closes, roll.
    await resetTacticalMovementForTurn(f.sessionId, f.heroId);
    await setTurn(f, 0);
    const r2 = await attack(f, f.heroId, f.foeId);
    expect(r2.resolvedAs).not.toBe('movement_only');
    expect(typeof r2.d20).toBe('number');
    expect(typeof r2.hit).toBe('boolean');
  });

  test('rift (D5-021): both sides advance to the rift edge; the refusal is reasoned; no dead end', async () => {
    const rift: Blocked[] = Array.from({ length: 12 }, (_, y) => ({
      x: 7,
      y,
      terrain: 'pit' as const,
      decoration: 'rift',
    }));
    const f = await seed({
      width: 14,
      height: 12,
      hero: { x: 4, y: 6 },
      foe: { x: 11, y: 6 },
      blocked: rift,
      foeName: 'Chiropteran Hulk',
    });
    // Player turn 1 at 35 ft: advances to the rift edge instead of standing still.
    const r1 = await attack(f, f.heroId, f.foeId);
    expect(r1.resolvedAs).toBe('movement_only');
    expect((await entityAt(f, f.heroId)).x).toBe(6);
    // Enemy turn 1: advances to its own edge too.
    await setTurn(f, 1);
    await resetTacticalMovementForTurn(f.sessionId, f.foeId);
    const r2 = await attack(f, f.foeId, f.heroId);
    expect(r2.resolvedAs).toBe('movement_only');
    expect((await entityAt(f, f.foeId)).x).toBe(8);
    // Player turn 2: no closer cell exists — a reasoned refusal that names the
    // outcome, moves 0 ft, and still leaves legal actions on the turn.
    await setTurn(f, 0);
    await resetTacticalMovementForTurn(f.sessionId, f.heroId);
    const r3 = await attack(f, f.heroId, f.foeId);
    expect(r3.resolvedAs).toBe('movement_only');
    expect(r3.movedFeet).toBe(0);
    expect(r3.refusalReason).toBe('no_reachable_adjacent_cell');
    expect(String(r3.narrative)).toContain('no attack was rolled');
    const legal = await getLegalCombatActions(f.encounterId, f.userId);
    expect(legal.actions.length).toBeGreaterThan(0);
    expect(legal.actions.map((a) => String(a.type))).toContain('end_turn');
    // Nor here: at the rift edge no attack is offered against a target that
    // cannot be reached, so the turn cannot loop on a refused attack.
    expect(legal.actions.map((a) => String(a.type))).not.toContain('attack');
  });

  test('pillar at 30 ft (N2 shape): the path around the pillar costs 25 ft and the attack rolls', async () => {
    const f = await seed({
      width: 12,
      height: 12,
      hero: { x: 2, y: 6 },
      foe: { x: 8, y: 6 },
      blocked: [{ x: 5, y: 6, terrain: 'wall', decoration: 'pillar' }],
    });
    const r = await attack(f, f.heroId, f.foeId);
    expect(r.resolvedAs).not.toBe('movement_only');
    expect(typeof r.d20).toBe('number');
    expect(typeof r.hit).toBe('boolean');
    expect(distFt(await entityAt(f, f.heroId), await entityAt(f, f.foeId))).toBe(5);
    // The detour's cost is the claim: the cheapest reaching cell is 25 ft of
    // path (not the 30 ft route), so exactly 5 ft of movement remains.
    expect((await entityAt(f, f.heroId)).movementRemaining).toBe(5);
  });

  test('rift with a Large foe (the D5-021 hulk footprint): it still advances to the rift edge', async () => {
    const rift: Blocked[] = Array.from({ length: 12 }, (_, y) => ({
      x: 7,
      y,
      terrain: 'pit' as const,
      decoration: 'rift',
    }));
    const f = await seed({
      width: 14,
      height: 12,
      hero: { x: 4, y: 6 },
      foe: { x: 11, y: 6 },
      blocked: rift,
      foeName: 'Chiropteran Hulk',
      foeSize: 'large',
    });
    const r1 = await attack(f, f.heroId, f.foeId);
    expect(r1.resolvedAs).toBe('movement_only');
    expect((await entityAt(f, f.heroId)).x).toBe(6);
    await setTurn(f, 1);
    await resetTacticalMovementForTurn(f.sessionId, f.foeId);
    const r2 = await attack(f, f.foeId, f.heroId);
    expect(r2.resolvedAs).toBe('movement_only');
    // The 2x2 hulk closes to the rift edge (footprint x 8-9) instead of standing at 35 ft.
    expect((await entityAt(f, f.foeId)).x).toBe(8);
    expect(r2.movedFeet).toBe(15);
  });

  test('adjacent control: the attack rolls and nobody moves', async () => {
    const f = await seed({ width: 12, height: 12, hero: { x: 6, y: 6 }, foe: { x: 7, y: 6 } });
    const r = await attack(f, f.heroId, f.foeId);
    expect(r.resolvedAs).not.toBe('movement_only');
    expect(typeof r.d20).toBe('number');
    expect(typeof r.hit).toBe('boolean');
    expect((await entityAt(f, f.heroId)).movementRemaining).toBe(30);
  });
});

/**
 * #975 (reopened): the TYPED Second Wind. The block above proves the tray's
 * `second_wind` intent; Hark's retest typed "I use Second Wind." in chat and
 * got narration only, because nothing on the DM route detected the words.
 * These tests drive `resolveCombatSecondWind` — the resolver the DM route
 * (routes/v1/llm.ts) runs pre-generation on the player's own words — against
 * the same encounter shape: the heal lands through the participant, the
 * sheet use is spent, and a refusal (uses spent, full health) is returned as
 * a directive instead of silence.
 */
describeWithDb('a typed Second Wind resolves through the DM-route resolver (#975)', () => {
  let db: ReturnType<typeof realDb>;
  const userId = testId('typed-fighter-user');

  const MAX_HP = 12;

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let secondWindFeatureId: string;

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
        name: testId('typed-fighter'),
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

    const library = await db
      .select()
      .from(classFeaturesLibrary)
      .where(eq(classFeaturesLibrary.className, 'Fighter'));
    const secondWind = library.find((row) => row.featureName === 'Second Wind');
    if (!secondWind) throw new Error('Fighter library rows not seeded');
    secondWindFeatureId = secondWind.id;
    await db.insert(characterFeatures).values({
      characterId,
      featureId: secondWind.id,
      usesRemaining: secondWind.usesCount,
      isActive: true,
      acquiredAtLevel: 1,
    });

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
          name: 'Typed Fighter',
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
    const monsterId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 1, maxHp: MAX_HP, isConscious: true },
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

  const heroHp = async (): Promise<number> => {
    const [row] = await db
      .select({ hp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, heroId));
    return row.hp;
  };

  const usesRemaining = async (): Promise<number | null> => {
    const [row] = await db
      .select({ uses: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, secondWindFeatureId),
        ),
      );
    return row?.uses ?? null;
  };

  const setHeroHp = async (hp: number) => {
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: hp })
      .where(eq(combatParticipantStatus.participantId, heroId));
  };

  /** A later turn: the engine refunds the bonus action at the turn boundary. */
  const newTurn = async () => {
    await db
      .update(combatParticipants)
      .set({ bonusActionUsed: false })
      .where(eq(combatParticipants.id, heroId));
  };

  /** The saved player message the DM route reads the declaration back from. */
  const typeMessage = async (text: string) => {
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      speakerId: characterId,
      message: text,
    });
  };

  const bonusActionUsed = async (): Promise<boolean> => {
    const [row] = await db
      .select({ used: combatParticipants.bonusActionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    return row.used;
  };

  const sheetHp = async (): Promise<number> => {
    const [row] = await db
      .select({ hp: characterStats.currentHitPoints })
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    return row.hp;
  };

  test('typed "I use Second Wind" heals through the participant and spends the sheet use', async () => {
    expect(await heroHp()).toBe(1);
    expect(await usesRemaining()).toBe(1);
    await typeMessage('I use Second Wind');

    const directive = await resolveCombatSecondWind({
      playerInput: 'I use Second Wind',
      sessionId,
      userId,
    });

    const hpAfter = await heroHp();
    const healed = hpAfter - 1;
    // The heal RANGE, not just "some healing" (strategist FIX 6347116450):
    // an L1 Fighter's Second Wind is 1d10 + level = 2–11, capped at max
    // HP. The hero is seeded at 1/12 so the deficit is 11 and every value
    // in the range is reachable — both bounds of the assert are live.
    expect(healed).toBeGreaterThanOrEqual(2);
    expect(healed).toBeLessThanOrEqual(11);
    expect(hpAfter).toBeLessThanOrEqual(MAX_HP);
    expect(directive).not.toBeNull();
    // The directive's numbers are the engine's, not a substring that a
    // malformed result ("regained undefined HP") could satisfy.
    expect(directive).toContain(`regained ${healed} HP`);
    expect(directive).toContain(`(now ${hpAfter}/${MAX_HP})`);
    expect(await usesRemaining()).toBe(0);
    // The real intent ran: the bonus action is claimed and the heal wrote
    // through to the sheet's own HP.
    expect(await bonusActionUsed()).toBe(true);
    expect(await sheetHp()).toBe(hpAfter);
  });

  test('a retry of the same saved message resolves nothing twice', async () => {
    // No new player message: the Retry replays the one from the test above.
    const hpBefore = await heroHp();

    const directive = await resolveCombatSecondWind({
      playerInput: 'I use Second Wind',
      sessionId,
      userId,
    });

    expect(directive).toBeNull();
    expect(await heroHp()).toBe(hpBefore);
    expect(await usesRemaining()).toBe(0);
  });

  test('a second typed use with the use spent returns the refusal, not silence', async () => {
    await setHeroHp(5);
    await newTurn();
    await typeMessage('I use Second Wind again');

    const directive = await resolveCombatSecondWind({
      playerInput: 'I use Second Wind again',
      sessionId,
      userId,
    });

    expect(directive).not.toBeNull();
    expect(directive).toContain('The engine refused it');
    expect(directive).toContain('no uses remaining');
    expect(await heroHp()).toBe(5);
    expect(await usesRemaining()).toBe(0);
  });

  test('at full health the typed use is refused and the use is kept', async () => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 1 })
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, secondWindFeatureId),
        ),
      );
    await setHeroHp(MAX_HP);
    await newTurn();
    await typeMessage('Second Wind');

    const directive = await resolveCombatSecondWind({
      playerInput: 'Second Wind',
      sessionId,
      userId,
    });

    expect(directive).not.toBeNull();
    expect(directive).toContain('The engine refused it');
    expect(directive).toContain('full health');
    expect(await heroHp()).toBe(MAX_HP);
    expect(await usesRemaining()).toBe(1);
  });

  test('words that never name the feature resolve nothing', async () => {
    const directive = await resolveCombatSecondWind({
      playerInput: 'I attack the golem',
      sessionId,
      userId,
    });
    expect(directive).toBeNull();
  });
});
