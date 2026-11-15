/**
 * #712: Lay on Hands pool mechanics.
 */
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';

import {
  campaigns,
  characterConditions,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  conditionsLibrary,
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

  it('two concurrent unnamed draws on a 1-HP gap heal once and charge the pool once (#885)', async () => {
    // Full pool (5), paladin missing 1 HP. Each unnamed draw reads the same
    // missing HP; the pool may be charged only for HP that actually lands.
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
      .set({ currentHitPoints: 11 })
      .where(eq(characterStats.characterId, paladinId));

    const results = await Promise.all(
      Array.from({ length: 2 }, () =>
        resolveLayOnHands({
          characterId: paladinId,
          userId: paladinUserId,
          targetCharacterId: paladinId,
          sessionId,
          context: 'unnamed-concurrency-check',
        }),
      ),
    );

    const healedTotal = results.reduce((sum, r) => sum + (r.ok ? r.healed : 0), 0);
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, paladinId))
      .limit(1);
    expect(stats.currentHitPoints).toBe(12);
    expect(healedTotal).toBe(1);
    expect(await poolRemaining(layOnHandsId)).toBe(4);
  });

  it('a retry after the usage log fails heals once, not twice (#885)', async () => {
    // Pool 5, paladin at 2 of 12 HP. Make the usage-log insert fail for this
    // call only, using a real trigger (no mock). The failed attempt must not
    // leave a heal or a pool draw behind, so the retry is the only one that counts.
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
      .set({ currentHitPoints: 2 })
      .where(eq(characterStats.characterId, paladinId));

    const suffix = testId('1531-trg')
      .replace(/[^a-z0-9_]/gi, '_')
      .toLowerCase();
    const fnName = `loh_fail_usage_${suffix}`;
    const trgName = `loh_fail_usage_trg_${suffix}`;
    try {
      await db.execute(
        sql.raw(
          `CREATE OR REPLACE FUNCTION "${fnName}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected usage-log failure'; END; $$ LANGUAGE plpgsql`,
        ),
      );
      await db.execute(
        sql.raw(
          `CREATE TRIGGER "${trgName}" BEFORE INSERT ON feature_usage_log FOR EACH ROW WHEN (NEW.character_id = '${paladinId}') EXECUTE FUNCTION "${fnName}"()`,
        ),
      );
      await expect(
        resolveLayOnHands({
          characterId: paladinId,
          userId: paladinUserId,
          targetCharacterId: paladinId,
          amount: 2,
          sessionId,
          context: 'retry-after-log-failure',
        }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${trgName}" ON feature_usage_log`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${fnName}"()`));
    }

    const retry = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      targetCharacterId: paladinId,
      amount: 2,
      sessionId,
      context: 'retry-after-log-failure',
    });
    expect(retry.ok).toBe(true);

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, paladinId))
      .limit(1);
    // One heal: 2 + 2 = 4. A replayed heal would read 6.
    expect(stats.currentHitPoints).toBe(4);
    // One draw: 5 - 2 = 3. A replayed draw would read 1.
    expect(await poolRemaining(layOnHandsId)).toBe(3);
  });

  it('a failed refund after the heal rolls back the heal with the claim (#1531)', async () => {
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
      .set({ currentHitPoints: 10 })
      .where(eq(characterStats.characterId, paladinId));

    const [poolRow] = await db
      .select({ id: characterFeatures.id })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      )
      .limit(1);
    const poolRowId = poolRow.id;

    const suffix = testId('1531-refund')
      .replace(/[^a-z0-9_]/gi, '_')
      .toLowerCase();
    const fnName = `loh_fail_refund_${suffix}`;
    const trgName = `loh_fail_refund_trg_${suffix}`;
    try {
      await db.execute(
        sql.raw(
          `CREATE OR REPLACE FUNCTION "${fnName}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected refund failure'; END; $$ LANGUAGE plpgsql`,
        ),
      );
      await db.execute(
        sql.raw(
          `CREATE TRIGGER "${trgName}" BEFORE UPDATE ON character_features FOR EACH ROW WHEN (OLD.id = '${poolRowId}' AND NEW.uses_remaining > OLD.uses_remaining) EXECUTE FUNCTION "${fnName}"()`,
        ),
      );

      await expect(
        resolveLayOnHands({
          characterId: paladinId,
          userId: paladinUserId,
          targetCharacterId: paladinId,
          amount: 4,
          sessionId,
          context: 'refund-failure-1531',
        }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${trgName}" ON character_features`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${fnName}"()`));
    }

    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, paladinId))
      .limit(1);
    // Before #1531 the heal committed on its own connection and this read 12.
    expect(stats.currentHitPoints).toBe(10);

    expect(await poolRemaining(layOnHandsId)).toBe(5);

    const logs = await db
      .select()
      .from(featureUsageLog)
      .where(
        and(
          eq(featureUsageLog.characterId, paladinId),
          eq(featureUsageLog.context, 'refund-failure-1531'),
        ),
      );
    expect(logs.length).toBe(0);
  });

  it('Lay on Hands refuses a character outside the paladin campaign and spends nothing (#1531)', async () => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 5 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );

    const otherUserId = testId('1531-other-user');
    const [{ id: otherCampaignId }] = await db
      .insert(campaigns)
      .values({ userId: otherUserId, name: testId('1531-other-camp') })
      .returning({ id: campaigns.id });

    const [{ id: otherCharacterId }] = await db
      .insert(characters)
      .values({
        userId: otherUserId,
        campaignId: otherCampaignId,
        name: testId('1531-other-char'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId: otherCharacterId,
      maxHitPoints: 12,
      currentHitPoints: 5,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    const result = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      targetCharacterId: otherCharacterId,
      sessionId,
      context: 'outside-campaign-1531',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_target');
    }

    const [otherStats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, otherCharacterId))
      .limit(1);
    expect(otherStats.currentHitPoints).toBe(5);

    expect(await poolRemaining(layOnHandsId)).toBe(5);
  });

  it('a poison cure on a character outside the campaign clears nothing and spends nothing (#1531)', async () => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 5 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );

    // ensure Poisoned condition library row
    await db
      .insert(conditionsLibrary)
      .values({ name: 'Poisoned', description: 'test', mechanicalEffects: 'test' })
      .onConflictDoNothing();
    const [poisonedRow] = await db
      .select({ id: conditionsLibrary.id })
      .from(conditionsLibrary)
      .where(eq(conditionsLibrary.name, 'Poisoned'))
      .limit(1);
    const conditionId = poisonedRow.id;

    const otherUserId = testId('1531-other-user-2');
    const [{ id: otherCampaignId }] = await db
      .insert(campaigns)
      .values({ userId: otherUserId, name: testId('1531-other-camp-2') })
      .returning({ id: campaigns.id });

    const [{ id: outsideCharacterId }] = await db
      .insert(characters)
      .values({
        userId: otherUserId,
        campaignId: otherCampaignId,
        name: testId('1531-outside-char-2'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId: outsideCharacterId,
      maxHitPoints: 12,
      currentHitPoints: 5,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    await db.insert(characterConditions).values({
      characterId: outsideCharacterId,
      conditionId,
      isActive: true,
    });

    const result = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      targetCharacterId: outsideCharacterId,
      cure: 'poison',
      sessionId,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_target');
    }

    const [cond] = await db
      .select()
      .from(characterConditions)
      .where(eq(characterConditions.characterId, outsideCharacterId))
      .limit(1);
    expect(cond.isActive).toBe(true);

    expect(await poolRemaining(layOnHandsId)).toBe(5);
  });

  it('Lay on Hands still heals an ally in the paladin campaign (#1531)', async () => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 5 })
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, layOnHandsId),
        ),
      );

    const [{ id: allyId }] = await db
      .insert(characters)
      .values({
        userId: paladinUserId,
        campaignId,
        name: testId('1531-ally'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId: allyId,
      maxHitPoints: 12,
      currentHitPoints: 9,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });

    const result = await resolveLayOnHands({
      characterId: paladinId,
      userId: paladinUserId,
      targetCharacterId: allyId,
      sessionId,
      context: 'ally-heal-1531',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.healed).toBe(3);
    }

    const [allyStats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, allyId))
      .limit(1);
    expect(allyStats.currentHitPoints).toBe(12);

    expect(await poolRemaining(layOnHandsId)).toBe(2);
  });
});
