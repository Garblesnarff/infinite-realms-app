/**
 * #1233: the Flexible Casting chip body through the real intent route.
 *
 * The client posts `flexibleCastingIntentBody(...)` (shared/test-fixtures/flexible-casting-intent.ts),
 * the same bytes the hook test asserts. This suite posts that body to the real route against the
 * real database and checks what the engine did: the slot and the sorcery points moved by the 2014
 * table, the bonus action was spent, and a refusal spent nothing and refunded the bonus action.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { and, eq, inArray } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterFeatures,
  characterSpellSlots,
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
  FLEXIBLE_CASTING_ACTOR_ID,
  flexibleCastingIntentBody,
} from '../../../../../../shared/test-fixtures/flexible-casting-intent';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../../services/__tests__/fixtures/real-db.js';

const userId = `flexible-casting-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'flexible-casting@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) {
  console.warn('[flexible-casting-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');
}

describeWithDb('Flexible Casting bodies resolve through the real route (#1233)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const libraryNames = [
    'Font of Magic',
    'Flexible Casting: Converting Spell Slot',
    'Flexible Casting: Creating Spell Slots',
  ];
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let fontId: string;
  let convertId: string;
  let createId: string;

  const post = async (body: unknown) => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, text: await response.text() };
  };

  const slot = async (level: number) => {
    const [row] = await db
      .select({ total: characterSpellSlots.totalSlots, used: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, level),
        ),
      );
    return row;
  };

  const points = async () => {
    const [row] = await db
      .select({ usesRemaining: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, fontId),
        ),
      );
    return row.usesRemaining;
  };

  const bonusActionUsed = async () => {
    const [row] = await db
      .select({ bonusActionUsed: combatParticipants.bonusActionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, FLEXIBLE_CASTING_ACTOR_ID));
    return row.bonusActionUsed;
  };

  // Each test starts from a known sheet and turn: 3 points, 4 first-level slots (none used),
  // 2 second-level slots (none used), the bonus action unspent, encounter at version 1.
  const reset = async (pointsNow: number) => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: pointsNow })
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, fontId),
        ),
      );
    await db
      .update(characterSpellSlots)
      .set({ totalSlots: 4, usedSlots: 0 })
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, 1),
        ),
      );
    await db
      .update(characterSpellSlots)
      .set({ totalSlots: 2, usedSlots: 0 })
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, 2),
        ),
      );
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.id, FLEXIBLE_CASTING_ACTOR_ID));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, currentRound: 1, version: 1 })
      .where(eq(combatEncounters.id, encounterId));
  };

  beforeAll(async () => {
    if (!hasRealDb) return;
    const library = await db
      .select({ id: classFeaturesLibrary.id, name: classFeaturesLibrary.featureName })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Sorcerer'),
          inArray(classFeaturesLibrary.featureName, libraryNames),
        ),
      );
    fontId = library.find((row) => row.name === 'Font of Magic')?.id ?? '';
    convertId = library.find((row) => row.name === libraryNames[1])?.id ?? '';
    createId = library.find((row) => row.name === libraryNames[2])?.id ?? '';
    expect(fontId).toBeTruthy();
    expect(convertId).toBeTruthy();
    expect(createId).toBeTruthy();

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1233-route-campaign') })
      .returning({ id: campaigns.id });
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        campaignId,
        name: testId('1233-route-sorcerer'),
        class: 'Sorcerer',
        level: 3,
        classLevels: [{ className: 'Sorcerer', level: 3 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 8,
      constitution: 14,
      maxHitPoints: 16,
      currentHitPoints: 16,
      speed: 30,
      armorClass: 12,
    });
    await db.insert(characterFeatures).values([
      { characterId, featureId: fontId, usesRemaining: 3, isActive: true, acquiredAtLevel: 2 },
      { characterId, featureId: convertId, isActive: true, acquiredAtLevel: 2 },
      { characterId, featureId: createId, isActive: true, acquiredAtLevel: 2 },
    ]);
    await db.insert(characterSpellSlots).values([
      { characterId, spellLevel: 1, totalSlots: 4, usedSlots: 0 },
      { characterId, spellLevel: 2, totalSlots: 2, usedSlots: 0 },
    ]);

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning({ id: combatEncounters.id });
    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          id: FLEXIBLE_CASTING_ACTOR_ID,
          encounterId,
          characterId,
          name: testId('1233-route-sorcerer'),
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 16,
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
    const foeId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      {
        participantId: FLEXIBLE_CASTING_ACTOR_ID,
        currentHp: 16,
        maxHp: 16,
        isConscious: true,
      },
      { participantId: foeId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
    await db.insert(tacticalMaps).values({
      sessionId,
      state: {
        id: testId('1233-route-map'),
        sessionId,
        width: 3,
        height: 3,
        cells: [],
        entities: [
          {
            id: FLEXIBLE_CASTING_ACTOR_ID,
            name: 'Sorcerer',
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
        sceneDescription: '1233 route fixture',
      },
      active: true,
    });
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await reset(3);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  test('convert: the exact client body spends a 1st-level slot for 1 sorcery point and the bonus action', async () => {
    await reset(1);
    const response = await post(flexibleCastingIntentBody('convert', 1));
    expect(response.status).toBe(200);
    expect((await slot(1))?.used).toBe(1);
    expect(await points()).toBe(2);
    expect(await bonusActionUsed()).toBe(true);
  });

  test('create: the exact client body spends 2 points for a 1st-level slot', async () => {
    const response = await post(flexibleCastingIntentBody('create', 1));
    expect(response.status).toBe(200);
    expect(await points()).toBe(1);
    expect((await slot(1))?.total).toBe(5);
    expect(await bonusActionUsed()).toBe(true);
  });

  test('convert at a full pool is refused with 422, spends no slot, and keeps the bonus action', async () => {
    // reset(3): 3 of 3 points, the Font of Magic maximum at Sorcerer 3. A convert gains nothing.
    const response = await post(flexibleCastingIntentBody('convert', 1));
    expect(response.status).toBe(422);
    expect((await slot(1))?.used).toBe(0);
    expect(await points()).toBe(3);
    expect(await bonusActionUsed()).toBe(false);
  });

  test('a partial convert gains only the points that fit, and spends the slot', async () => {
    await reset(2);
    // 2 of 3 points: a 2nd-level slot can gain only 1 point before the pool is full.
    const response = await post(flexibleCastingIntentBody('convert', 2));
    expect(response.status).toBe(200);
    expect((await slot(2))?.used).toBe(1);
    expect(await points()).toBe(3);
    expect(await bonusActionUsed()).toBe(true);
  });

  test('a create the points cannot pay for is refused, spends nothing, and keeps the bonus action', async () => {
    await reset(1);
    // A 2nd-level slot costs 3 points (2014 table): 1 point is not enough.
    const response = await post(flexibleCastingIntentBody('create', 2));
    expect(response.status).toBe(422);
    expect(await points()).toBe(1);
    expect((await slot(2))?.total).toBe(2);
    expect(await bonusActionUsed()).toBe(false);
  });
});
