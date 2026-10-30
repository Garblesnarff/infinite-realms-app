/**
 * #712: Divine Sense usage tracking.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
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

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer 712-test-token'
      ? {
          user: { userId: testId('712-user'), email: 'test@example.test', plan: 'free' },
          error: null,
        }
      : { user: null, error: 'Unauthorized' },
}));

// #712: the paladin pool services, imported lazily so the no-database run that
// degrades every describeWithDb block to skip never loads db/client.
const { spendDivineSense } = await importWithRealDb(
  () => import('../../../services/progression/paladin-features-service.js'),
);
const { ClassFeatureUsageService } = await importWithRealDb(
  () => import('../../../services/progression/class-feature-usage-service.js'),
);
const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { tacticalMapRoutes } = await importWithRealDb(() => import('../tactical-maps.js'));
const { combatRoutes } = await importWithRealDb(() => import('../combat/index.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(tacticalMapRoutes).use(combatRoutes)
  : null;

if (!hasRealDb) {
  console.warn(
    '[sheet-feature-rest] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('paladin Divine Sense tracking (#712)', () => {
  // Fresh client per block: earlier blocks close the shared one in afterAll.
  let db: ReturnType<typeof realDb>;
  const paladinUserId = testId('712-user');

  let campaignId: string;
  let sessionId: string;
  let encounterId: string;
  let paladinId: string;
  let participantId: string;

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

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();

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

  it('Divine Sense decrements uses through the usage service (CHA 8 -> 1 use)', async () => {
    const first = await spendDivineSense({
      characterId: paladinId,
      userId: paladinUserId,
      sessionId,
      context: 'story-turn',
    });
    expect(first.success).toBe(true);
    expect(first.usesRemaining).toBe(0);

    const second = await spendDivineSense({
      characterId: paladinId,
      userId: paladinUserId,
      sessionId,
      context: 'story-turn',
    });
    expect(second.success).toBe(false);
    expect(second.usesRemaining).toBe(0);

    // A long rest replenishes the Divine Sense pool.
    const restored = await ClassFeatureUsageService.restoreFeatures({
      characterId: paladinId,
      restType: 'long',
      userId: paladinUserId,
    });
    expect(restored.featuresRestored).toContain('Divine Sense');

    const third = await spendDivineSense({
      characterId: paladinId,
      userId: paladinUserId,
      sessionId,
      context: 'story-turn',
    });
    expect(third.success).toBe(true);
    expect(third.usesRemaining).toBe(0);
  });

  it('combat Divine Sense chip posts through the real intent route and refuses an empty pool', async () => {
    await ClassFeatureUsageService.restoreFeatures({
      characterId: paladinId,
      restType: 'long',
      userId: paladinUserId,
    });
    const post = async () =>
      app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer 712-test-token',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            intent: { type: 'divine_sense', actorId: participantId },
            source: 'dm',
            dmStartedAt: 1_700_000_000_000,
            origin: 'typed',
          }),
        }),
      );
    const spent = await post();
    expect(spent.status).toBe(200);
    await db
      .update(combatParticipants)
      .set({ actionUsed: false })
      .where(eq(combatParticipants.id, participantId));
    const refused = await post();
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      details: { reason: 'feature_uses_exhausted', featureName: 'Divine Sense' },
    });
  });
});
