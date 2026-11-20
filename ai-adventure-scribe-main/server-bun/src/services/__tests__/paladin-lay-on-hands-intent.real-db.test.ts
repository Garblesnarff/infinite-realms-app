/**
 * #1554: Lay on Hands as a combat action, through the real intent route (POST
 * /v1/combat/:id/intent). The body is the shared fixture's shape (heal 5) with the real ids and
 * the live encounter version. Runs only in the real-DB CI job; never against a shared database.
 */
import { afterAll, beforeAll, beforeEach, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  featureUsageLog,
  gameSessions,
} from '../../../../db/schema/index';
import {
  LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY,
  LAY_ON_HANDS_HEAL_INTENT_BODY,
} from '../../../../shared/test-fixtures/lay-on-hands-intent';

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const lohUserId = testId('1554-combat-user');
mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer 1554-test-token'
      ? {
          user: { userId: lohUserId, email: 'test@example.test', plan: 'free' },
          error: null,
        }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline.js'));
const { resolveCombatLayOnHands } = await importWithRealDb(
  () => import('../../services/dm/combat-lay-on-hands.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/intents.js'));
const { getLegalCombatActions } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

describeWithDb('Lay on Hands combat intent through the real route (#1554)', () => {
  let db: ReturnType<typeof realDb>;
  const userId = lohUserId;
  let campaignId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let characterId: string;
  let featureId: string;

  const version = async (): Promise<number> =>
    (
      await db
        .select({ version: combatEncounters.version })
        .from(combatEncounters)
        .where(eq(combatEncounters.id, encounterId))
    )[0].version;

  const send = async (amount: number) => {
    const body = {
      ...LAY_ON_HANDS_HEAL_INTENT_BODY,
      intent: {
        ...LAY_ON_HANDS_HEAL_INTENT_BODY.intent,
        actorId: heroId,
        targetId: heroId,
        amount,
        expectedVersion: await version(),
      },
    };
    return app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer 1554-test-token' },
        body: JSON.stringify(body),
      }),
    );
  };

  /** #1670: the chosen-amount body the client sends, with this test's real ids. */
  const sendChosenFixture = async () => {
    const body = {
      ...LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY,
      intent: {
        ...LAY_ON_HANDS_CHOSEN_AMOUNT_INTENT_BODY.intent,
        actorId: heroId,
        targetId: heroId,
        expectedVersion: await version(),
      },
    };
    return app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer 1554-test-token' },
        body: JSON.stringify(body),
      }),
    );
  };

  const readState = async () => {
    const [hp] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, heroId));
    const [pool] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      );
    const usage = await db
      .select({ id: featureUsageLog.id })
      .from(featureUsageLog)
      .where(eq(featureUsageLog.featureId, featureId));
    const [part] = await db
      .select({ actionUsed: combatParticipants.actionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    return {
      hp: hp.currentHp,
      pool: pool?.usesRemaining ?? null,
      usage: usage.length,
      actionUsed: part.actionUsed,
    };
  };

  const setHp = (currentHp: number) =>
    db
      .update(combatParticipantStatus)
      .set({ currentHp })
      .where(eq(combatParticipantStatus.participantId, heroId));

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
      .values({ userId, name: testId('1554-combat-camp') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('1554-combat-pal'), class: 'Paladin', level: 1 })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      charisma: 8,
      maxHitPoints: 12,
      currentHitPoints: 7,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    [{ id: heroId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId,
        name: 'Test Paladin',
        participantType: 'player',
        turnOrder: 0,
        initiative: 10,
        maxHp: 12,
      })
      .returning({ id: combatParticipants.id });
    await db.insert(combatParticipantStatus).values({
      participantId: heroId,
      currentHp: 7,
      maxHp: 12,
      isConscious: true,
    });
    // #1554 set-up: a lone player ends the encounter on its first intent (the engine calls
    // it over with no opposition), so every later test would hit COMBAT_INTENT_AFTER_CONCLUSION.
    // A living foe keeps the fight open for the whole suite.
    const [{ id: foeId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        name: 'Practice Dummy',
        participantType: 'monster',
        turnOrder: 1,
        initiative: 1,
        armorClass: 10,
        maxHp: 400,
        speed: 0,
      })
      .returning({ id: combatParticipants.id });
    await db.insert(combatParticipantStatus).values({
      participantId: foeId,
      currentHp: 400,
      maxHp: 400,
      isConscious: true,
    });
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    // Each test starts from an open fight with the hero's turn and its Action free.
    await db
      .update(combatEncounters)
      .set({ status: 'active', currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db.delete(featureUsageLog).where(eq(featureUsageLog.featureId, featureId));
    await db
      .delete(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      );
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false, reactionUsed: false })
      .where(eq(combatParticipants.id, heroId));
    await setHp(7);
  });

  afterAll(async () => {
    if (hasRealDb) await closeRealDb();
  });

  it('heal 5 gives HP +5, pool -5, one usage row, and spends the Action', async () => {
    const response = await send(5);
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await readState();
    expect(after.hp).toBe(12);
    expect(after.pool).toBe(0);
    expect(after.usage).toBe(1);
    expect(after.actionUsed).toBe(true);
  });

  // #1670: the player stepped the heal to 3 of the 5 offered. The engine heals 3, draws 3, and the
  // response carries the pool number the sheet panel shows at once.
  it('a chosen heal of 3 gives HP +3, pool -3, and the response carries the engine pool', async () => {
    await setHp(7);
    const response = await sendChosenFixture();
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await readState();
    expect(after.hp).toBe(10);
    expect(after.pool).toBe(2);
    expect(after.usage).toBe(1);
    expect(after.actionUsed).toBe(true);
    const payload = (await response.json()) as { result?: { poolRemaining?: number } };
    expect(payload.result?.poolRemaining).toBe(2);
  });

  // #1670: the heal chip the More stepper reads carries the engine's default and its cap.
  it('the legal-actions heal chip carries the engine cap as maxAmount', async () => {
    await setHp(7);
    const legal = await getLegalCombatActions(encounterId, userId);
    const heal = legal.actions.find(
      (action) => action.type === 'lay_on_hands' && action.cure === undefined,
    );
    expect(heal).toMatchObject({ targetId: heroId, amount: 5, maxAmount: 5 });
  });

  it('an amount over the pool is 422 and nothing is spent', async () => {
    await setHp(1);
    const response = await send(6);
    expect(response.status).toBe(422);
    const after = await readState();
    expect(after.hp).toBe(1);
    expect(after.pool).toBe(5);
    expect(after.usage).toBe(0);
    expect(after.actionUsed).toBe(false);
  });

  it('a typed Lay on Hands in combat returns the engine line the reply carries (#1554)', async () => {
    await setHp(7);
    const laid = await resolveCombatLayOnHands({
      playerInput: 'I use Lay on Hands on myself for 5 hit points',
      sessionId,
      userId,
    });
    expect(laid).not.toBeNull();
    expect(laid!.engineLine).toContain('restores 5 HP');
    expect(laid!.directive).toContain('<lay_on_hands>');
    const after = await readState();
    expect(after.hp).toBe(12);
    expect(after.pool).toBe(0);
    expect(after.usage).toBe(1);
  });

  it('a fully healed target is refused and nothing is spent', async () => {
    await setHp(12);
    const response = await send(1);
    expect(response.status).toBe(422);
    const after = await readState();
    expect(after.hp).toBe(12);
    expect(after.pool).toBe(5);
    expect(after.usage).toBe(0);
    expect(after.actionUsed).toBe(false);
  });
});
