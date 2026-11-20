/**
 * #1554: Lay on Hands out of combat, through the real characters route (POST
 * /v1/characters/:id/lay-on-hands). The sheet body is the shared fixture the client sends.
 * Runs only in the real-DB CI job (TEST_DATABASE_URL); never against a shared database.
 */
import { afterAll, beforeAll, beforeEach, expect, it, mock } from 'bun:test';
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
import {
  LAY_ON_HANDS_SHEET_CURE_BODY,
  LAY_ON_HANDS_SHEET_HEAL_BODY,
} from '../../../../../shared/test-fixtures/lay-on-hands-intent';
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

const lohUserId = testId('1554-user');
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer 1554-test-token'
      ? {
          user: { userId: lohUserId, email: 'test@example.test', plan: 'free' },
          error: null,
        }
      : { user: null, error: 'Unauthorized' },
}));

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  return createRequestPipelineApp().use(charactersRoutes);
});

describeWithDb('POST /v1/characters/:id/lay-on-hands (#1554)', () => {
  let db: ReturnType<typeof realDb>;
  const userId = lohUserId;
  let campaignId: string;
  let paladinId: string;
  let featureId: string;

  const post = (body: unknown) =>
    pipeline.handle(
      new Request(`http://localhost/v1/characters/${paladinId}/lay-on-hands`, {
        method: 'POST',
        headers: { authorization: 'Bearer 1554-test-token', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const pool = async (): Promise<number | null> => {
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
  const usageRows = async (): Promise<number> =>
    (
      await db
        .select({ id: featureUsageLog.id })
        .from(featureUsageLog)
        .where(eq(featureUsageLog.featureId, featureId))
    ).length;
  const setHp = async (currentHitPoints: number) =>
    db
      .update(characterStats)
      .set({ currentHitPoints })
      .where(eq(characterStats.characterId, paladinId));
  const hpNow = async (): Promise<number> =>
    (
      await db
        .select({ currentHitPoints: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, paladinId))
    )[0].currentHitPoints;

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
    const [existing] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Paladin'),
          eq(classFeaturesLibrary.featureName, 'Lay on Hands'),
        ),
      )
      .limit(1);
    featureId =
      existing?.id ??
      (
        await db
          .insert(classFeaturesLibrary)
          .values({
            className: 'Paladin',
            featureName: 'Lay on Hands',
            levelAcquired: 1,
            description: 'test',
            usageType: 'action',
            usesPerRest: 'long_rest',
            usesCount: null,
          })
          .returning({ id: classFeaturesLibrary.id })
      )[0].id;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1554-camp') })
      .returning({ id: campaigns.id });
    [{ id: paladinId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('1554-paladin'), class: 'Paladin', level: 1 })
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
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    // A level-1 paladin: the pool is 5. Each test starts from the same state.
    await db.delete(featureUsageLog).where(eq(featureUsageLog.featureId, featureId));
    await db
      .delete(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, paladinId),
          eq(characterFeatures.featureId, featureId),
        ),
      );
    await setHp(7);
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('heal 5 gives HP +5, pool -5, and one usage row', async () => {
    const response = await post(LAY_ON_HANDS_SHEET_HEAL_BODY);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await hpNow()).toBe(12);
    expect(await pool()).toBe(0);
    expect(await usageRows()).toBe(1);
  });

  it('a disease cure sends the shared cure body, spends 5 points, and moves no HP', async () => {
    const response = await post(LAY_ON_HANDS_SHEET_CURE_BODY);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await hpNow()).toBe(7);
    expect(await pool()).toBe(0);
    expect(await usageRows()).toBe(1);
  });

  it('refuses the sheet heal in an active encounter (422) and spends nothing', async () => {
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: paladinId, sessionNumber: 2, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    const [{ id: participantId }] = await db
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
    try {
      const response = await post(LAY_ON_HANDS_SHEET_HEAL_BODY);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: 'Use Lay on Hands from the combat actions',
      });
      expect(await hpNow()).toBe(7);
      expect(await usageRows()).toBe(0);
    } finally {
      await db.delete(combatParticipants).where(eq(combatParticipants.id, participantId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    }
  });

  it('an amount over the pool is 422 and spends nothing', async () => {
    await setHp(1);
    const response = await post({ amount: 6 });
    expect(response.status).toBe(422);
    expect(await hpNow()).toBe(1);
    expect(await pool()).toBe(5);
    expect(await usageRows()).toBe(0);
  });

  it('a fully healed target is refused and nothing is spent', async () => {
    await setHp(12);
    const response = await post({ amount: 1 });
    expect(response.status).toBe(422);
    expect(await hpNow()).toBe(12);
    expect(await pool()).toBe(5);
    expect(await usageRows()).toBe(0);
  });

  // #1679: an amount above the missing HP is clamped to the missing HP; the pool keeps the rest.
  it('an amount above the missing HP heals only the missing HP and spends only that (#1679)', async () => {
    await setHp(9);
    const response = await post({ amount: 5 });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await hpNow()).toBe(12);
    expect(await pool()).toBe(2);
    expect(await usageRows()).toBe(1);
  });
});
