/** #1635: the Cunning Action chip's wire body through the real intent route. */
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
  CUNNING_ACTOR_ID,
  cunningActionIntentBody,
} from '../../../../../../shared/test-fixtures/cunning-action-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `cunning-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'cunning@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) console.warn('[cunning-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');

describeWithDb('Cunning Action wire body resolves through the real route (#1635)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;

  const post = (body: unknown) =>
    app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  beforeAll(async () => {
    if (!hasRealDb) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1635-route-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('1635-route-rogue'),
        class: 'Rogue',
        level: 2,
        classLevels: [{ className: 'Rogue', level: 2 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 8,
      dexterity: 16,
      maxHitPoints: 9,
      currentHitPoints: 9,
      speed: 30,
      armorClass: 14,
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
          id: CUNNING_ACTOR_ID,
          encounterId,
          characterId,
          name: 'The Rogue',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 9,
          speed: 30,
        },
        {
          encounterId,
          name: 'Goblin Guard',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 5,
          armorClass: 12,
          maxHp: 20,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    heroId = participants.find((row) => row.turnOrder === 0)!.id;
    const goblinId = participants.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 9, maxHp: 9, isConscious: true },
      { participantId: goblinId, currentHp: 20, maxHp: 20, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('1635-map'),
        sessionId,
        width: 12,
        height: 10,
        cells: Array.from({ length: 10 }, () =>
          Array.from({ length: 12 }, () => ({
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
            name: 'The Rogue',
            type: 'pc',
            x: 4,
            y: 4,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: goblinId,
            name: 'Goblin Guard',
            type: 'monster',
            x: 5,
            y: 4,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
        round: 1,
        sceneDescription: '1635 route fixture',
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
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  test('the Dash chip body is accepted, and a second Cunning Action in the turn is refused', async () => {
    const first = await post(cunningActionIntentBody('dash'));
    expect(first.status).toBe(200);

    const [row] = await db
      .select({
        bonusActionUsed: combatParticipants.bonusActionUsed,
        actionUsed: combatParticipants.actionUsed,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    expect(row).toMatchObject({ bonusActionUsed: true, actionUsed: false });

    const second = await post(cunningActionIntentBody('disengage'));
    expect(second.status).toBe(422);
    expect(await second.json()).toEqual(
      expect.objectContaining({
        error: 'Cunning Action needs the bonus action, and it is already spent this turn.',
      }),
    );
  });
});
