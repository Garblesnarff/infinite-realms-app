/** #1635: Grapple, Shove and Hide chips through the real intent route. */
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
  CHECK_MENU_ACTOR_ID,
  CHECK_MENU_GIANT_ID,
  CHECK_MENU_TARGET_ID,
  combatCheckMenuIntentBody,
} from '../../../../../../shared/test-fixtures/combat-check-menu-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `check-menu-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'check-menu@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb)
  console.warn('[check-menu-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');

describeWithDb('Check menu chips resolve through the real route (#1635)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let goblinId: string;
  let giantId: string;

  const getLegal = () =>
    app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/legal-actions`, {
        method: 'GET',
        headers: { authorization: `Bearer ${userId}` },
      }),
    );

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
      .values({ userId, name: testId('1635-check-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('1635-check-fighter'),
        class: 'Fighter',
        level: 1,
        classLevels: [{ className: 'Fighter', level: 1 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      dexterity: 12,
      maxHitPoints: 10,
      currentHitPoints: 10,
      speed: 30,
      armorClass: 16,
    });
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    await db.insert(combatParticipants).values([
      {
        id: CHECK_MENU_ACTOR_ID,
        encounterId,
        characterId,
        name: 'Hero',
        participantType: 'player',
        turnOrder: 0,
        initiative: 20,
        armorClass: 16,
        maxHp: 10,
        speed: 30,
      },
      {
        id: CHECK_MENU_TARGET_ID,
        encounterId,
        name: 'Goblin',
        participantType: 'monster',
        turnOrder: 1,
        initiative: 5,
        armorClass: 12,
        maxHp: 20,
        speed: 30,
      },
      {
        id: CHECK_MENU_GIANT_ID,
        encounterId,
        name: 'Hill Giant',
        participantType: 'monster',
        turnOrder: 2,
        initiative: 3,
        armorClass: 13,
        maxHp: 105,
        speed: 40,
      },
    ]);
    heroId = CHECK_MENU_ACTOR_ID;
    goblinId = CHECK_MENU_TARGET_ID;
    giantId = CHECK_MENU_GIANT_ID;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 10, maxHp: 10, isConscious: true },
      { participantId: goblinId, currentHp: 20, maxHp: 20, isConscious: true },
      { participantId: giantId, currentHp: 105, maxHp: 105, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('1635-check-map'),
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
            name: 'Hero',
            type: 'pc',
            x: 4,
            y: 4,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: goblinId,
            name: 'Goblin',
            type: 'monster',
            x: 5,
            y: 4,
            size: 'medium',
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: giantId,
            name: 'Hill Giant',
            type: 'monster',
            x: 6,
            y: 4,
            size: 'huge',
            speedFeet: 40,
            movementRemaining: 40,
          },
        ],
        round: 1,
        sceneDescription: '1635 check fixture',
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

  test('GET legal-actions lists check chips', async () => {
    const res = await getLegal();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: Array<Record<string, unknown>> };
    const checks = body.actions.filter((a) => a.type === 'check');
    expect(
      checks.some((a) => a.checkKind === 'grapple' && a.targetId === CHECK_MENU_TARGET_ID),
    ).toBe(true);
    expect(checks.some((a) => a.checkKind === 'shove' && a.targetId === CHECK_MENU_TARGET_ID)).toBe(
      true,
    );
    expect(checks.some((a) => a.checkKind === 'hide' && a.targetId === undefined)).toBe(true);
    expect(
      checks.some((a) => a.checkKind === 'grapple' && a.targetId === CHECK_MENU_GIANT_ID),
    ).toBe(false);
    expect(checks.some((a) => a.checkKind === 'shove' && a.targetId === CHECK_MENU_GIANT_ID)).toBe(
      false,
    );
    for (const c of checks) {
      expect(typeof c.checkModifier).toBe('number');
    }
  });

  test('refusal: stale shove-giant chip is 422 (typed path), actionUsed stays false', async () => {
    const res = await post(
      combatCheckMenuIntentBody('shove', { targetId: CHECK_MENU_GIANT_ID, d20: 12 }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: string };
    expect(typeof body.error).toBe('string');
    expect(body.error).toContain('no more than one size larger');
    const [row] = await db
      .select({ actionUsed: combatParticipants.actionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    expect(row.actionUsed).toBe(false);
  });

  test('grapple goblin succeeds, actionUsed true', async () => {
    const res = await post(
      combatCheckMenuIntentBody('grapple', { targetId: CHECK_MENU_TARGET_ID, d20: 15 }),
    );
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ actionUsed: combatParticipants.actionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, heroId));
    expect(row.actionUsed).toBe(true);
  });

  test('second chip refused because action spent', async () => {
    const res = await post(combatCheckMenuIntentBody('hide', { d20: 10 }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: string };
    expect(typeof body.error).toBe('string');
    expect((body.error ?? '').length).toBeGreaterThan(0);
  });
});
