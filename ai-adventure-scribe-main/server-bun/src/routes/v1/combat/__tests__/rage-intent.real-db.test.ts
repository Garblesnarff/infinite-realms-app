/**
 * Rage (#1638) posted through the real intent route, as the More-menu chip posts it.
 *
 * The body is `fighterFeatureChipIntentBody('rage')` from the shared wire fixture, the same bytes the
 * client executor is tested against. The route, the claim, the use spend, and the bonus action all run
 * for real against a real Postgres. A refusal must spend nothing and leave the bonus action free.
 * No suite here calls the live DM.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  campaigns,
  characterFeatures,
  characterEquipment,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
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

const userId = `rage-intent-route-${process.pid}`;

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === `Bearer ${userId}`
      ? { user: { userId, email: 'rage-intent@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../../http-pipeline.js'),
);
const { intentRoutes } = await importWithRealDb(() => import('../intents.js'));

const { executeCombatCheck } = await importWithRealDb(
  () => import('../../../../services/combat/combat-check-service.js'),
);

const app = hasRealDb
  ? createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes))
  : null;

if (!hasRealDb) {
  console.warn('[rage-intent-route] SKIPPED: set TEST_DATABASE_URL to run this suite.');
}

describeWithDb('Rage posts through the real intent route (#1638)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let featureId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('rage-route-camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('rage-route-barbarian'),
        level: 1,
        class: 'Barbarian',
        classLevels: [{ className: 'Barbarian', level: 1 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      constitution: 14,
      maxHitPoints: 14,
      currentHitPoints: 14,
      speed: 30,
      armorClass: 14,
    });

    [{ id: featureId }] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Barbarian',
        featureName: 'Rage',
        levelAcquired: 1,
        // Test-only row: the description is never asserted, only the NOT NULL column it fills.
        description:
          'Test-only Rage row (two uses at 1st level), inserted by the #1638 route suite.',
        usageType: 'limited_use',
        usesPerRest: 'long_rest',
        usesCount: 2,
      })
      .returning({ id: classFeaturesLibrary.id });
    await db
      .insert(characterFeatures)
      .values({ characterId, featureId, usesRemaining: 2, isActive: true, acquiredAtLevel: 1 });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    // The chip's actor id is the fixture's, so the participant takes that id.
    await db.insert(combatParticipants).values([
      {
        id: FIGHTER_FEATURE_ACTOR_ID,
        encounterId,
        characterId,
        name: 'The Barbarian',
        participantType: 'player',
        turnOrder: 0,
        initiative: 20,
        armorClass: 14,
        maxHp: 14,
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
    ]);
    const [golem] = await db
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .where(
        and(eq(combatParticipants.encounterId, encounterId), eq(combatParticipants.turnOrder, 1)),
      );
    await db.insert(combatParticipantStatus).values([
      {
        participantId: FIGHTER_FEATURE_ACTOR_ID,
        currentHp: 14,
        maxHp: 14,
        isConscious: true,
      },
      { participantId: golem.id, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId));
    await db.delete(classFeaturesLibrary).where(eq(classFeaturesLibrary.id, featureId));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  /** Two Rage uses, the bonus action free, round 1, no Rage live. */
  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 2 })
      .where(eq(characterFeatures.characterId, characterId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatEncounters)
      .set({ currentRound: 1, currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
  });

  /** Posts the chip body and returns the status and the parsed answer. */
  const postRage = async (): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await app!.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${userId}`, 'content-type': 'application/json' },
        body: JSON.stringify(fighterFeatureChipIntentBody('rage')),
      }),
    );
    return {
      status: response.status,
      body: JSON.parse(await response.text()) as Record<string, unknown>,
    };
  };

  const usesLeft = async (): Promise<number> => {
    const [row] = await db
      .select({ uses: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, characterId));
    return row.uses ?? -1;
  };

  const bonusActionUsed = async (): Promise<boolean> => {
    const [row] = await db
      .select({ used: combatParticipants.bonusActionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, FIGHTER_FEATURE_ACTOR_ID));
    return row.used;
  };

  test('the chip body spends a use and the bonus action, and answers the uses left and the expiry', async () => {
    const response = await postRage();
    expect(response.status).toBe(200);
    const result = response.body.result as { usesRemaining?: number; expiresRound?: number };
    expect(result.usesRemaining).toBe(1);
    expect(result.expiresRound).toBe(1 + 10);
    expect(await usesLeft()).toBe(1);
    expect(await bonusActionUsed()).toBe(true);
  });

  test('combat state exposes a live Rage mark and drops it on expiry', async () => {
    const isMarked = async () => {
      const response = await app!.handle(
        new Request(`http://localhost/v1/combat/sessions/${sessionId}/active`, {
          headers: { authorization: `Bearer ${userId}` },
        }),
      );
      expect(response.status).toBe(200);
      const { combat } = (await response.json()) as {
        combat: { participants: Array<{ id: string; raging?: boolean }> };
      };
      return combat.participants.find((participant) => participant.id === FIGHTER_FEATURE_ACTOR_ID);
    };
    expect(await isMarked()).not.toHaveProperty('raging');
    expect((await postRage()).status).toBe(200);
    expect(await isMarked()).toHaveProperty('raging', true);
    await db
      .update(combatEncounters)
      .set({ currentRound: 11 })
      .where(eq(combatEncounters.id, encounterId));
    expect(await isMarked()).not.toHaveProperty('raging');
  });

  test('a refused Rage with no uses left spends nothing and leaves the bonus action free', async () => {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 0 })
      .where(eq(characterFeatures.characterId, characterId));

    const response = await postRage();
    expect(response.status).toBe(422);
    expect(await usesLeft()).toBe(0);
    expect(await bonusActionUsed()).toBe(false);
  });

  test('a second Rage while raging is refused, and spends neither a use nor the bonus action', async () => {
    expect((await postRage()).status).toBe(200);
    expect(await usesLeft()).toBe(1);

    // The first Rage used the bonus action; free it so only the live Rage can refuse this one.
    await db
      .update(combatParticipants)
      .set({ bonusActionUsed: false })
      .where(eq(combatParticipants.id, FIGHTER_FEATURE_ACTOR_ID));

    const second = await postRage();
    expect(second.status).toBe(422);
    expect(await usesLeft()).toBe(1);
    expect(await bonusActionUsed()).toBe(false);
  });
  test('level 20 offers Rage even with zero stored uses and spends no use', async () => {
    await db
      .update(characters)
      .set({ level: 20, classLevels: [{ className: 'Barbarian', level: 20 }] })
      .where(eq(characters.id, characterId));
    try {
      await db
        .update(characterFeatures)
        .set({ usesRemaining: 0 })
        .where(eq(characterFeatures.characterId, characterId));
      const response = await app!.handle(
        new Request(`http://localhost/v1/combat/${encounterId}/legal-actions`, {
          headers: { authorization: `Bearer ${userId}` },
        }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).actions).toContainEqual({ type: 'rage', label: 'Rage' });
      const activation = await postRage();
      expect(activation.status).toBe(200);
      expect(activation.body.result).toMatchObject({ usesRemaining: -1 });
      expect(await usesLeft()).toBe(0);
      expect(await bonusActionUsed()).toBe(true);
    } finally {
      await db
        .update(characters)
        .set({ level: 1, classLevels: [{ className: 'Barbarian', level: 1 }] })
        .where(eq(characters.id, characterId));
    }
  });

  test('equipped heavy armor prevents Rage without spending a use or bonus action', async () => {
    const [armor] = await db
      .insert(characterEquipment)
      .values({
        characterId,
        itemName: 'Chain Mail',
        itemType: 'armor',
        equipped: true,
      })
      .returning({ id: characterEquipment.id });
    try {
      const response = await postRage();
      expect(response.status).toBe(422);
      expect(JSON.stringify(response.body)).toContain('heavy armor');
      expect(await usesLeft()).toBe(2);
      expect(await bonusActionUsed()).toBe(false);
    } finally {
      await db.delete(characterEquipment).where(eq(characterEquipment.id, armor.id));
    }
  });

  test('a raging Barbarian keeps the higher Strength check die', async () => {
    expect((await postRage()).status).toBe(200);
    const [foe] = await db
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .where(
        and(eq(combatParticipants.encounterId, encounterId), eq(combatParticipants.turnOrder, 1)),
      );
    const [encounter] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    const dice = [18, 10];
    const result = await executeCombatCheck(
      {
        encounterId,
        actorId: FIGHTER_FEATURE_ACTOR_ID,
        targetId: foe.id,
        userId,
        expectedVersion: encounter.version,
        intent: { kind: 'shove', verb: 'shove' },
        d20: 2,
      },
      () => dice.shift() ?? 1,
    );
    expect(result.actorRoll.d20).toBe(18);
    expect(result.success).toBe(true);
  });
});
