/** #613: the More-menu Dash body through the real intent route and tactical map. */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  tacticalMaps,
} from '../../../../../../db/schema/index';
import {
  DASH_ACTOR_ID,
  dashIntentBody,
} from '../../../../../../shared/test-fixtures/combat-dash-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `dash-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'dash@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) console.warn('[dash-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');

describeWithDb('Dash More-menu body resolves through the real route (#613)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let foeId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('613-route-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('613-route-runner'),
        class: 'Fighter',
        level: 1,
        classLevels: [{ className: 'Fighter', level: 1 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      constitution: 14,
      maxHitPoints: 12,
      currentHitPoints: 12,
      speed: 30,
      armorClass: 15,
    });
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
          id: DASH_ACTOR_ID,
          encounterId,
          characterId,
          name: 'The Runner',
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
      { participantId: heroId, currentHp: 12, maxHp: 12, isConscious: true },
      { participantId: foeId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('613-map'),
        sessionId,
        width: 3,
        height: 3,
        cells: Array.from({ length: 3 }, () =>
          Array.from({ length: 3 }, () => ({
            terrain: 'floor',
            blocksMovement: false,
            blocksSight: false,
            cover: 0,
            elevation: 0,
          })),
        ),
        entities: [
          {
            id: heroId,
            name: 'The Runner',
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
        sceneDescription: '613 route fixture',
      },
      active: true,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  test('posts the exact bar body, doubles movement, and returns the gained distance', async () => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(dashIntentBody()),
      }),
    );
    const body = (await response.json()) as {
      result?: { movementGainedFeet?: number };
      engineRows?: unknown[];
    };
    expect(response.status).toBe(200);
    expect(body.result?.movementGainedFeet).toBe(30);
    expect(body.engineRows).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'dash' })]),
    );

    const legalActionsResponse = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/legal-actions`, {
        headers: { authorization: `Bearer ${userId}` },
      }),
    );
    const legalActions = (await legalActionsResponse.json()) as {
      actions?: Array<{ type?: string }>;
    };
    expect(legalActionsResponse.status).toBe(200);
    expect(legalActions.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'move' })]),
    );

    const [map] = await db
      .select({ state: tacticalMaps.state })
      .from(tacticalMaps)
      .where(eq(tacticalMaps.sessionId, sessionId));
    const hero = (
      map.state as { entities: Array<{ id: string; movementRemaining: number }> }
    ).entities.find((entity) => entity.id === DASH_ACTOR_ID);
    expect(hero?.movementRemaining).toBe(60);
  });
});
