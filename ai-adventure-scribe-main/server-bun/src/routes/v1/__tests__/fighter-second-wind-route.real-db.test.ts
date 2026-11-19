/**
 * #1576: Second Wind from the sheet, through the real characters route (POST
 * /v1/characters/:id/second-wind). The sheet body is the shared fixture the client sends.
 * Runs only in the real-DB CI job (TEST_DATABASE_URL); never against a shared database.
 */
import { afterAll, beforeAll, beforeEach, expect, it, mock, spyOn } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipants,
  featureUsageLog,
  gameSessions,
} from '../../../../../db/schema/index';
import { SECOND_WIND_SHEET_BODY } from '../../../../../shared/test-fixtures/second-wind-sheet';
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
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const swUserId = testId('1576-user');
const swOtherUserId = testId('1576-other-user');
const SW_TOKEN = 'Bearer 1576-test-token';
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === SW_TOKEN
      ? {
          user: { userId: swUserId, email: 'test@example.test', plan: 'free' },
          error: null,
        }
      : { user: null, error: 'Unauthorized' },
}));

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  return createRequestPipelineApp().use(charactersRoutes);
});

const vitals = await importWithRealDb(async () => {
  const { CharacterVitalsService } = await import('../../../services/character-vitals-service.js');
  return CharacterVitalsService;
});

describeWithDb('POST /v1/characters/:id/second-wind (#1576)', () => {
  let db: ReturnType<typeof realDb>;
  let campaignId: string;
  let fighterId: string;
  let wizardId: string;
  let otherUsersFighterId: string;
  let featureId: string;

  const post = (characterId: string, body: unknown = SECOND_WIND_SHEET_BODY) =>
    pipeline.handle(
      new Request(`http://localhost/v1/characters/${characterId}/second-wind`, {
        method: 'POST',
        headers: { authorization: SW_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const uses = async (characterId: string): Promise<number | null> => {
    const [row] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      )
      .limit(1);
    return row?.usesRemaining ?? null;
  };
  const usageRows = async (): Promise<number> =>
    (
      await db
        .select({ id: featureUsageLog.id })
        .from(featureUsageLog)
        .where(eq(featureUsageLog.featureId, featureId))
    ).length;
  const setHp = async (characterId: string, currentHitPoints: number) =>
    db
      .update(characterStats)
      .set({ currentHitPoints })
      .where(eq(characterStats.characterId, characterId));
  // The sheet's mirror of the use: the tracker shows currentUses / maxUses from this JSON.
  const sheetSecondWind = async (characterId: string) => {
    const [row] = await db
      .select({ classFeatures: characters.classFeatures })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    return (row?.classFeatures as Record<string, { currentUses?: number; maxUses?: number }> | null)
      ?.second_wind;
  };
  const hpNow = async (characterId: string): Promise<number> =>
    (
      await db
        .select({ currentHitPoints: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId))
    )[0].currentHitPoints;

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
    const [existing] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Fighter'),
          eq(classFeaturesLibrary.featureName, 'Second Wind'),
        ),
      )
      .limit(1);
    featureId =
      existing?.id ??
      (
        await db
          .insert(classFeaturesLibrary)
          .values({
            className: 'Fighter',
            featureName: 'Second Wind',
            levelAcquired: 1,
            description: 'test',
            usageType: 'bonus_action',
            usesPerRest: 'short_rest',
            usesCount: null,
          })
          .returning({ id: classFeaturesLibrary.id })
      )[0].id;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: swUserId, name: testId('1576-camp') })
      .returning({ id: campaigns.id });
    [{ id: fighterId }] = await db
      .insert(characters)
      .values({
        userId: swUserId,
        campaignId,
        name: testId('1576-fighter'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });
    [{ id: wizardId }] = await db
      .insert(characters)
      .values({
        userId: swUserId,
        campaignId,
        name: testId('1576-wizard'),
        class: 'Wizard',
        level: 1,
      })
      .returning({ id: characters.id });
    [{ id: otherUsersFighterId }] = await db
      .insert(characters)
      .values({
        userId: swOtherUserId,
        campaignId,
        name: testId('1576-other'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });
    for (const id of [fighterId, wizardId, otherUsersFighterId]) {
      await db.insert(characterStats).values({
        characterId: id,
        charisma: 8,
        maxHitPoints: 12,
        currentHitPoints: 7,
        temporaryHitPoints: 0,
        isConscious: true,
        vitalState: 'standing',
      });
    }
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    // Each test starts from a level-1 fighter with one Second Wind use, 7 of 12 HP.
    await db.delete(featureUsageLog).where(eq(featureUsageLog.featureId, featureId));
    await db.delete(characterFeatures).where(eq(characterFeatures.featureId, featureId));
    await db.insert(characterFeatures).values([
      { characterId: fighterId, featureId, acquiredAtLevel: 1, usesRemaining: 1 },
      { characterId: otherUsersFighterId, featureId, acquiredAtLevel: 1, usesRemaining: 1 },
    ]);
    await setHp(fighterId, 7);
    await setHp(otherUsersFighterId, 7);
    await db.update(characters).set({ classFeatures: null }).where(eq(characters.id, fighterId));
  });

  afterAll(async () => {
    if (hasRealDb) await closeRealDb();
  });

  it('heals 1d10 + level, capped at max HP, and returns the numbers the sheet shows', async () => {
    const response = await post(fighterId);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      roll: number;
      fighterLevel: number;
      healed: number;
      newHp: number;
      maxHp: number;
      usesRemaining: number;
    };
    expect(body.roll).toBeGreaterThanOrEqual(1);
    expect(body.roll).toBeLessThanOrEqual(10);
    expect(body.fighterLevel).toBe(1);
    expect(body.maxHp).toBe(12);
    // 7 of 12 HP: the room left is 5, so the heal is the smaller of 1d10 + 1 and 5.
    expect(body.healed).toBe(Math.min(body.roll + 1, 5));
    expect(body.newHp).toBe(7 + body.healed);
    expect(await hpNow(fighterId)).toBe(body.newHp);
    expect(body.usesRemaining).toBe(0);
    expect(await uses(fighterId)).toBe(0);
    expect(await usageRows()).toBe(1);
    // The mirror the sheet shows: one use of one, spent.
    expect(await sheetSecondWind(fighterId)).toMatchObject({ currentUses: 0, maxUses: 1 });
  });

  it('caps the heal at max HP when the room left is smaller than 1d10 + level', async () => {
    await setHp(fighterId, 11);
    const response = await post(fighterId);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { healed: number; newHp: number; maxHp: number };
    expect(body.healed).toBe(1);
    expect(body.newHp).toBe(12);
    expect(body.maxHp).toBe(12);
    expect(await hpNow(fighterId)).toBe(12);
    expect(await sheetSecondWind(fighterId)).toMatchObject({ currentUses: 0, maxUses: 1 });
  });

  it('a second use before a rest is refused with nothing changed', async () => {
    const first = await post(fighterId);
    expect(first.status, await first.clone().text()).toBe(200);
    await setHp(fighterId, 1);
    const hpBefore = await hpNow(fighterId);
    const usesBefore = await uses(fighterId);
    const rowsBefore = await usageRows();

    const second = await post(fighterId);
    expect(second.status).toBe(422);
    expect(await second.json()).toMatchObject({ details: { reason: 'feature_uses_exhausted' } });
    expect(await hpNow(fighterId)).toBe(hpBefore);
    expect(await uses(fighterId)).toBe(usesBefore);
    expect(await usageRows()).toBe(rowsBefore);
  });

  it('a failure after the heal leaves HP and uses unchanged', async () => {
    const original = vitals.heal.bind(vitals);
    const forced = spyOn(vitals, 'heal').mockImplementation(async (...args) => {
      await original(...args);
      throw new Error('forced failure after the heal');
    });
    try {
      const response = await post(fighterId);
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(await hpNow(fighterId)).toBe(7);
      expect(await uses(fighterId)).toBe(1);
      expect(await usageRows()).toBe(0);
    } finally {
      forced.mockRestore();
    }
  });

  it('a character that is not a Fighter is refused with nothing spent', async () => {
    await db
      .insert(characterFeatures)
      .values({ characterId: wizardId, featureId, acquiredAtLevel: 1, usesRemaining: 1 });
    const response = await post(wizardId);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ details: { reason: 'feature_not_on_sheet' } });
    expect(await hpNow(wizardId)).toBe(7);
    expect(await uses(wizardId)).toBe(1);
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, wizardId));
  });

  it("another user's character is refused with nothing changed", async () => {
    const response = await post(otherUsersFighterId);
    expect(response.status).toBe(404);
    expect(await hpNow(otherUsersFighterId)).toBe(7);
    expect(await uses(otherUsersFighterId)).toBe(1);
  });

  it('refuses in an active encounter (422) and spends nothing', async () => {
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: fighterId, sessionNumber: 3, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const [{ id: participantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId: fighterId,
        name: 'Test Fighter',
        participantType: 'player',
        turnOrder: 0,
        initiative: 10,
        maxHp: 12,
      })
      .returning({ id: combatParticipants.id });
    try {
      const response = await post(fighterId);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: 'Use Second Wind from the combat actions',
      });
      expect(await hpNow(fighterId)).toBe(7);
      expect(await uses(fighterId)).toBe(1);
      expect(await usageRows()).toBe(0);
    } finally {
      await db.delete(combatParticipants).where(eq(combatParticipants.id, participantId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    }
  });
});
