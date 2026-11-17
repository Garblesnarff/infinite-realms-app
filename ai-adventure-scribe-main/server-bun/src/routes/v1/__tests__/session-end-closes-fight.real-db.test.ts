/**
 * #1619: End session closes the session's open fight. Runs the real sessions route
 * (POST /v1/sessions/:id/complete) and the real characters route (POST
 * /v1/characters/:id/lay-on-hands) in one pipeline, against the real database.
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
  sessionChronicles,
} from '../../../../../db/schema/index';
import { LAY_ON_HANDS_SHEET_HEAL_BODY } from '../../../../../shared/test-fixtures/lay-on-hands-intent';
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

const endUserId = testId('1619-user');
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer 1619-test-token'
      ? {
          user: { userId: endUserId, email: 'test@example.test', plan: 'free' },
          error: null,
        }
      : { user: null, error: 'Unauthorized' },
}));

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { charactersRoutes } = await import('../characters.js');
  const { sessionsRoutes } = await import('../sessions.js');
  return createRequestPipelineApp().use(sessionsRoutes).use(charactersRoutes);
});

describeWithDb('End session closes the open fight (#1619)', () => {
  let db: ReturnType<typeof realDb>;
  const userId = endUserId;
  let campaignId: string;
  let paladinId: string;
  let featureId: string;

  const auth = { authorization: 'Bearer 1619-test-token', 'content-type': 'application/json' };

  const endSession = (sessionId: string): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({}),
      }),
    );

  const layOnHandsHeal = (): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost/v1/characters/${paladinId}/lay-on-hands`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(LAY_ON_HANDS_SHEET_HEAL_BODY),
      }),
    );

  const hpNow = async (): Promise<number> =>
    (
      await db
        .select({ currentHitPoints: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, paladinId))
    )[0].currentHitPoints;

  const setHp = async (currentHitPoints: number): Promise<void> => {
    await db
      .update(characterStats)
      .set({ currentHitPoints })
      .where(eq(characterStats.characterId, paladinId));
  };

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
      .values({ userId, name: testId('1619-camp') })
      .returning({ id: campaigns.id });
    [{ id: paladinId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('1619-paladin'), class: 'Paladin', level: 1 })
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

  it('End session ends the open fight, and the sheet heal is then allowed (200)', async () => {
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: paladinId, sessionNumber: 3, status: 'active' })
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
      // Before End session: the sheet refuses the heal because the fight is active.
      const during = await layOnHandsHeal();
      expect(during.status).toBe(422);

      const ended = await endSession(sessionId);
      expect(ended.status, await ended.clone().text()).toBe(200);

      const [encounter] = await db
        .select({ status: combatEncounters.status, endedReason: combatEncounters.endedReason })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId));
      expect(encounter.status).toBe('completed');
      expect(encounter.endedReason).toBe('abandoned');

      const healed = await layOnHandsHeal();
      expect(healed.status, await healed.clone().text()).toBe(200);
      expect(await hpNow()).toBe(12);
    } finally {
      await db.delete(combatParticipants).where(eq(combatParticipants.id, participantId));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
      await db.delete(sessionChronicles).where(eq(sessionChronicles.sessionId, sessionId));
      await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    }
  });
});
