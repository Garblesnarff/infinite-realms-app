/**
 * #975: the More-menu Fighter feature body through the real intent route.
 *
 * The client sends the versionless DM envelope produced by
 * executeAuthoritativeCombatIntent for both chips. Keep this suite on the
 * real route and the real database so feature ownership, HP writes, use
 * tracking, rest reset, and the pending DM fact are exercised together.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  tacticalMaps,
} from '../../../../../../db/schema/index';
import {
  FIGHTER_FEATURE_ACTOR_ID,
  fighterFeatureChipIntentBody,
} from '../../../../../../shared/test-fixtures/fighter-feature-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `fighter-feature-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'fighter-feature@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));
const { RestService } = await importWithRealDb(
  () => import('../../../../services/rest-service.js'),
);

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) {
  console.warn('[fighter-feature-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');
}

describeWithDb('Fighter feature More-menu bodies resolve through the real route (#975)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let foeId: string;
  let secondWindId: string;
  let actionSurgeId: string;

  const postChip = async (type: 'second_wind' | 'action_surge') => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(fighterFeatureChipIntentBody(type)),
      }),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    return JSON.parse(text) as { result?: Record<string, unknown>; engineRows?: unknown[] };
  };

  const setFeatureUses = async (featureId: string, usesRemaining: number) => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining })
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      );
  };

  const resetTurn = async () => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, currentRound: 1, version: 1 })
      .where(eq(combatEncounters.id, encounterId));
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('975-route-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('975-route-fighter'),
        class: 'Fighter',
        level: 2,
        classLevels: [{ className: 'Fighter', level: 2 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      constitution: 14,
      maxHitPoints: 12,
      currentHitPoints: 4,
      speed: 30,
      armorClass: 15,
    });

    const fighterFeatures = await db
      .select({ id: classFeaturesLibrary.id, name: classFeaturesLibrary.featureName })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Fighter'),
          inArray(classFeaturesLibrary.featureName, [
            'Second Wind',
            'Action Surge',
            'Action Surge (1 use)',
          ]),
        ),
      );
    secondWindId = fighterFeatures.find((row) => row.name === 'Second Wind')?.id ?? '';
    actionSurgeId =
      fighterFeatures.find((row) => row.name === 'Action Surge')?.id ??
      fighterFeatures.find((row) => row.name === 'Action Surge (1 use)')?.id ??
      '';
    expect(secondWindId).toBeTruthy();
    expect(actionSurgeId).toBeTruthy();
    await db.insert(characterFeatures).values([
      {
        characterId,
        featureId: secondWindId,
        usesRemaining: 1,
        isActive: true,
        acquiredAtLevel: 1,
      },
      {
        characterId,
        featureId: actionSurgeId,
        usesRemaining: 1,
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
    const participants = await db
      .insert(combatParticipants)
      .values([
        {
          id: FIGHTER_FEATURE_ACTOR_ID,
          encounterId,
          characterId,
          name: 'Fighter Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 12,
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
    heroId = participants.find((row) => row.turnOrder === 0)!.id;
    foeId = participants.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 4, maxHp: 12, isConscious: true },
      { participantId: foeId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('975-map'),
        sessionId,
        width: 3,
        height: 3,
        cells: [],
        entities: [
          {
            id: heroId,
            name: 'Fighter Hero',
            type: 'pc',
            x: 0,
            y: 0,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: foeId,
            name: 'Training Golem',
            type: 'monster',
            x: 2,
            y: 2,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        round: 1,
        sceneDescription: '975 route fixture',
      },
      active: true,
    });
  });

  beforeEach(async () => {
    await resetTurn();
    await setFeatureUses(secondWindId, 1);
    await setFeatureUses(actionSurgeId, 1);
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 4, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, heroId));
    await db
      .update(characterStats)
      .set({ currentHitPoints: 4 })
      .where(eq(characterStats.characterId, characterId));
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  test('Second Wind uses the exact bar body, heals, spends the feature, and leaves an engine fact', async () => {
    const response = await postChip('second_wind');
    const result = response.result as { applied?: boolean; healed?: number; newHp?: number };
    expect(result.applied).toBe(true);
    expect(result.healed).toBeGreaterThan(0);
    expect(result.newHp).toBeGreaterThan(4);
    const [feature] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(eq(characterFeatures.featureId, secondWindId));
    expect(feature.usesRemaining).toBe(0);
    const [map] = await db.select().from(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    expect((map.state as { pendingDmFacts?: string[] }).pendingDmFacts).toContain(
      'Fighter Hero used Second Wind and regained ' + result.healed + ' HP.',
    );
  });

  test('Action Surge accepts the suffix-named SRD row and arms one extra action', async () => {
    const response = await postChip('action_surge');
    expect(response.result).toMatchObject({
      applied: true,
      action: 'action_surge',
      extraActionArmed: true,
    });
    const [feature] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(eq(characterFeatures.featureId, actionSurgeId));
    expect(feature.usesRemaining).toBe(0);
    const [session] = await db
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    expect((session.state as { actionSurgeArmed?: unknown }).actionSurgeArmed).toBeTruthy();
  });

  test('a short rest restores both More-menu features', async () => {
    await setFeatureUses(secondWindId, 0);
    await setFeatureUses(actionSurgeId, 0);
    await RestService.takeShortRest(characterId, userId, 0);
    const rows = await db
      .select({ id: characterFeatures.featureId, uses: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, characterId));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: secondWindId, uses: 1 },
        { id: actionSurgeId, uses: 1 },
      ]),
    );
  });
});
