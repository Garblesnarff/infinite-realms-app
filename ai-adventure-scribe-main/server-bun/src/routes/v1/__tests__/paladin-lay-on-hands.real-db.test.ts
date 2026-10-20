/**
 * #712: Lay on Hands pool mechanics.
 */
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  dialogueHistory,
  featureUsageLog,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// #205: the pipeline below mounts issue1784DataRoutes, whose service executes
// a module-scope sql`` template; the db proxy validates the full server env
// on first use, and the real-DB CI job does not provide CORS_ORIGIN,
// WORKOS_API_KEY, WORKOS_CLIENT_ID, or PORT. Dummy values only — real values
// win via ??=, and nothing here is a secret.
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

// #712: the paladin pool services, imported lazily so the no-database run that
// degrades every describeWithDb block to skip never loads db/client.
const { layOnHandsPool, resolveLayOnHands } = await importWithRealDb(
  () => import('../../../services/progression/paladin-features-service.js'),
);
const { ClassFeatureUsageService } = await importWithRealDb(
  () => import('../../../services/progression/class-feature-usage-service.js'),
);
const { spendStoryFeatureUses } = await importWithRealDb(
  () => import('../../../services/dm/story-feature-uses.js'),
);

if (!hasRealDb) {
  console.warn(
    '[sheet-feature-rest] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('paladin Lay on Hands pool (#712)', () => {
  // Fresh client per block: earlier blocks close the shared one in afterAll.
  let db: ReturnType<typeof realDb>;
  const paladinUserId = testId('712-user');

  let campaignId: string;
  let sessionId: string;
  let encounterId: string;
  let paladinId: string;
  let participantId: string;
  let layOnHandsId: string;

  /** The SRD seed shape: limited_use features with a NULL uses_count (#224). */
  const ensureLibraryRow = async (featureName: string): Promise<string> => {
    const existing = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Paladin'),
          eq(classFeaturesLibrary.featureName, featureName),
        ),
      )
      .limit(1);
    if (existing.length > 0) return existing[0].id;
    const [row] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Paladin',
        featureName,
        levelAcquired: 1,
        description: 'test',
        usageType: 'action',
        usesPerRest: 'long_rest',
        usesCount: null,
      })
      .returning({ id: classFeaturesLibrary.id });
    return row.id;
  };

  const poolRemaining = async (featureId: string): Promise<number | null> => {
    const [row] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, featureId),
        ),
      )
      .limit(1);
    return row?.usesRemaining ?? null;
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();

    layOnHandsId = await ensureLibraryRow('Lay on Hands');
    await ensureLibraryRow('Divine Sense');

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: paladinUserId, name: testId('712-camp') })
      .returning({ id: campaigns.id });

    // The QA character: a level-1 paladin with CHA 8 (Divine Sense: max(1, 1-1) = 1).
    [{ id: paladinId }] = await db
      .insert(characters)
      .values({
        userId: paladinUserId,
        campaignId,
        name: testId('712-paladin'),
        class: 'Paladin',
        level: 1,
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId: paladinId,
      charisma: 8,
      maxHitPoints: 12,
      currentHitPoints: 7,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: paladinId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    [{ id: participantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId: paladinId,
        name: 'Test Paladin',
        participantType: 'player',
        turnOrder: 0,
        initiative: 10,
        maxHp: 12,
      })
      .returning({ id: combatParticipants.id });

    await db.insert(combatParticipantStatus).values({
      participantId,
      currentHp: 7,
      maxHp: 12,
      isConscious: true,
    });
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('Lay on Hands heals through the combat participant and decrements the pool', async () => {
    const pool = await layOnHandsPool(paladinId, paladinUserId);
    expect(pool?.max).toBe(5);
    expect(pool?.remaining).toBe(5);

    const result = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      participantId,
      encounterId,
      targetCharacterId: paladinId,
      sessionId,
      context: 'combat-turn',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.healed).toBe(5);
      expect(result.poolRemaining).toBe(0);
      expect(result.poolMax).toBe(5);
    }

    // The participant row moved, and the write-through moved the sheet too.
    const [status] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId))
      .limit(1);
    expect(status.currentHp).toBe(12);
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, paladinId))
      .limit(1);
    expect(stats.currentHitPoints).toBe(12);

    // The pool row the sheet reads is decremented, and the use was logged.
    expect(await poolRemaining(layOnHandsId)).toBe(0);
    const logs = await db
      .select()
      .from(featureUsageLog)
      .where(
        and(
          eq(featureUsageLog.characterId, paladinId),
          eq(featureUsageLog.featureId, layOnHandsId),
        ),
      );
    expect(logs.length).toBeGreaterThan(0);
  });

  it('a named amount larger than the missing HP draws only the missing HP', async () => {
    // Deterministic regardless of test order: full pool, target missing 3 HP.
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 5 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 9 })
      .where(eq(combatParticipantStatus.participantId, participantId));

    const result = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      participantId,
      encounterId,
      targetCharacterId: paladinId,
      amount: 20,
      sessionId,
      context: 'combat-turn',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // "for 20" on a target missing 3: the pool loses exactly 3, never 20.
      expect(result.healed).toBe(3);
      expect(result.poolRemaining).toBe(2);
      expect(result.poolMax).toBe(5);
    }
    const [status] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId))
      .limit(1);
    expect(status.currentHp).toBe(12);
    expect(await poolRemaining(layOnHandsId)).toBe(2);
  });

  it('a named amount on a full-HP target spends nothing', async () => {
    // Deterministic regardless of test order: pool at 4, target at full HP.
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 4 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 12 })
      .where(eq(combatParticipantStatus.participantId, participantId));

    const result = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      participantId,
      encounterId,
      targetCharacterId: paladinId,
      amount: 20,
      sessionId,
      context: 'combat-turn',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.healed).toBe(0);
      expect(result.poolRemaining).toBe(4);
      expect(result.poolMax).toBe(5);
    }
    expect(await poolRemaining(layOnHandsId)).toBe(4);
  });

  it('an empty Lay on Hands pool refuses clearly and spends nothing', async () => {
    // Deterministic regardless of test order: the pool is empty.
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 0 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );

    const result = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      participantId,
      encounterId,
      targetCharacterId: paladinId,
      sessionId,
      context: 'combat-turn',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('empty_pool');
      expect(result.message).toMatch(/empty/i);
      expect(result.message).toMatch(/long rest/i);
      expect(result.poolRemaining).toBe(0);
    }
    expect(await poolRemaining(layOnHandsId)).toBe(0);
  });

  it('a long rest replenishes the Lay on Hands pool', async () => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 2 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );

    const restored = await ClassFeatureUsageService.restoreFeatures({
      characterId: paladinId,
      restType: 'long',
      userId: paladinUserId,
    });
    expect(restored.featuresRestored).toContain('Lay on Hands');
    expect(await poolRemaining(layOnHandsId)).toBe(5);
  });

  it('a retried story turn spends Lay on Hands once — one heal, one pool draw (#712)', async () => {
    // Deterministic regardless of test order: full pool, paladin missing 5 HP.
    // The declared amount (3) is smaller than both the missing HP and the pool,
    // so a replay without the guard would visibly heal and draw again.
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 5 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );
    await db
      .update(characterStats)
      .set({ currentHitPoints: 7 })
      .where(eq(characterStats.characterId, paladinId));

    // The client saves the player message before the DM turn starts; a Retry
    // re-sends that saved message without saving a new one.
    const playerInput = 'I lay on hands to heal myself for 3 hit points';
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      speakerId: paladinId,
      message: playerInput,
    });

    const [character] = await db
      .select()
      .from(characters)
      .where(eq(characters.id, paladinId))
      .limit(1);

    const logCount = async (): Promise<number> =>
      (
        await db
          .select({ id: featureUsageLog.id })
          .from(featureUsageLog)
          .where(
            and(
              eq(featureUsageLog.characterId, paladinId),
              eq(featureUsageLog.featureId, layOnHandsId),
              eq(featureUsageLog.sessionId, sessionId),
            ),
          )
      ).length;
    const logsBefore = await logCount();

    const spend = () =>
      spendStoryFeatureUses({
        userId: paladinUserId,
        sessionId,
        playerInput,
        character,
        features: ['Lay on Hands'],
      });
    await spend();
    await spend(); // Retry: the same message, no new row.

    // One heal: 7 + 3 = 10. Without the guard the replay would heal 2 more (12).
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, paladinId))
      .limit(1);
    expect(stats.currentHitPoints).toBe(10);
    // One pool draw: 5 - 3 = 2. Without the guard the replay would draw 2 more (0).
    expect(await poolRemaining(layOnHandsId)).toBe(2);
    // One usage-log row for the replayed message, not two.
    expect((await logCount()) - logsBefore).toBe(1);
  });

  it('five concurrent 3-HP draws on a pool of 5 land exactly one — the pool ends at 2 (#712)', async () => {
    // Deterministic regardless of test order: full pool, paladin missing 5 HP.
    // A named amount is claimed whole with a conditional UPDATE before it
    // heals, so exactly one of the five claims can land against a pool of 5;
    // the four losers refuse instead of writing the same remainder.
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 5 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );
    await db
      .update(characterStats)
      .set({ currentHitPoints: 7 })
      .where(eq(characterStats.characterId, paladinId));

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        resolveLayOnHands({
          characterId: paladinId,
          userId: paladinUserId,
          targetCharacterId: paladinId,
          amount: 3,
          sessionId,
          context: 'concurrency-check',
        }),
      ),
    );

    expect(results.filter((result) => result.ok).length).toBe(1);
    expect(await poolRemaining(layOnHandsId)).toBe(2);
    // The one heal landed on the sheet: 7 + 3 = 10.
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, paladinId))
      .limit(1);
    expect(stats.currentHitPoints).toBe(10);
  });
});
