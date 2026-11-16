/** #604: a fight the player wins on initiative offers the player actions in round 1, through the real route. */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipants,
  gameSessions,
} from '../../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `round-one-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'round-one@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));
const { CombatEncounterService } = await importWithRealDb(
  () => import('../../../../services/combat/combat-encounter-service.js'),
);

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) console.warn('[round-one-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');

describeWithDb('round 1: the player wins initiative and is offered actions (#604)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let playerParticipantId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('604-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('604-hero'),
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

    // The player rolls 20 with +2 (22). The monster's modifier of -5 caps its roll at 15.
    const state = await CombatEncounterService.startCombat(
      sessionId,
      [
        {
          encounterId: '',
          characterId,
          name: 'The Veteran',
          initiativeModifier: 2,
          initiativeRoll: 20,
        },
        {
          encounterId: '',
          name: 'Training Golem',
          initiativeModifier: -5,
        },
      ],
      false,
      userId,
    );
    encounterId = state.encounter.id;
    const participants = await db
      .select({
        id: combatParticipants.id,
        participantType: combatParticipants.participantType,
        turnOrder: combatParticipants.turnOrder,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, encounterId));
    playerParticipantId = participants.find((row) => row.participantType === 'player')!.id;
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

  test('round 1 starts on the player, and the legal-actions route offers the player actions', async () => {
    const [encounter] = await db
      .select({
        currentRound: combatEncounters.currentRound,
        currentTurnOrder: combatEncounters.currentTurnOrder,
      })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    const [player] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, playerParticipantId));
    expect(encounter.currentRound).toBe(1);
    expect(player.turnOrder).toBe(0);
    expect(encounter.currentTurnOrder).toBe(player.turnOrder);

    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/legal-actions`, {
        headers: { authorization: `Bearer ${userId}` },
      }),
    );
    const legal = (await response.json()) as {
      actorId?: string;
      actions?: Array<{ type?: string }>;
    };
    expect(response.status).toBe(200);
    expect(legal.actorId).toBe(playerParticipantId);
    const types = (legal.actions ?? []).map((action) => action.type);
    expect(types).toEqual(expect.arrayContaining(['attack', 'dash', 'end_turn']));
  });
});
