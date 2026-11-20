/**
 * Rage on a real attack (#1638): the +2 on a raging Barbarian's Strength melee hit, and the half
 * damage a raging target takes from bludgeoning, piercing and slashing, against a real Postgres.
 *
 * The attack resolver is the production `resolveAttack`. The RNG is seeded, and each comparison runs
 * the same seed with and without the mark, so the only difference is the Rage term. The target is a
 * second character with a racial fire resistance, which must survive the Rage merge. No suite here
 * calls the live DM. Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

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
  characterStats,
  characters,
  combatEncounters,
  combatParticipantConditions,
  combatParticipantStatus,
  combatParticipants,
  conditionsLibrary,
  gameSessions,
  inventoryItems,
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';

const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { claimRage, isRaging } = await importWithRealDb(
  () => import('../combat/combat-turn-flags.js'),
);

if (!hasRealDb) {
  console.warn('[barbarian-rage-attack] SKIPPED: set TEST_DATABASE_URL to run these.');
}

/** A seed on which the first attack hits (the target's AC is 1, so only a natural 1 misses). */
const SEED = 4242;

describeWithDb('Rage on a real attack (#1638)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rage-attack-user');

  let campaignId: string;
  let barbarianCharacterId: string;
  let allyCharacterId: string;
  let sessionId: string;
  let encounterId: string;
  let barbarianId: string;
  let allyId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('rage-attack-camp') })
      .returning({ id: campaigns.id });

    [{ id: barbarianCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('barbarian'),
        level: 3,
        class: 'Barbarian',
        classLevels: [{ className: 'Barbarian', level: 3 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: barbarianCharacterId,
      strength: 16,
      dexterity: 12,
      charisma: 10,
      armorClass: 14,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });
    await db.insert(inventoryItems).values({
      characterId: barbarianCharacterId,
      name: 'Longsword',
      itemType: 'weapon',
      isEquipped: true,
    });

    [{ id: allyCharacterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('ally'), level: 1, class: 'Fighter' })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: allyCharacterId,
      strength: 10,
      dexterity: 10,
      charisma: 10,
      armorClass: 1,
      maxHitPoints: 500,
      currentHitPoints: 500,
      speed: 30,
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: barbarianCharacterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId: barbarianCharacterId,
          name: 'The Barbarian',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          characterId: allyCharacterId,
          name: 'The Ally',
          participantType: 'player',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 500,
          speed: 30,
          // A racial resistance the Rage merge must keep.
          damageResistances: ['fire'],
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    barbarianId = inserted.find((row) => row.turnOrder === 0)!.id;
    allyId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: barbarianId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: allyId, currentHp: 500, maxHp: 500, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, barbarianCharacterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, barbarianCharacterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, allyCharacterId));
    await db.delete(characters).where(eq(characters.id, barbarianCharacterId));
    await db.delete(characters).where(eq(characters.id, allyCharacterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  /** Clears the fight back to round 1, the Barbarian's turn, no marks, and full hit points. */
  const resetFight = async (): Promise<void> => {
    await db
      .update(combatEncounters)
      .set({ currentRound: 1, currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 500, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, allyId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 30, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, barbarianId));
  };

  /** Gives the Barbarian the turn and attacks the ally with the seed fixed. */
  const attackWithSeed = async (seed: number) => {
    setRngSeed(seed);
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });
    return combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: barbarianId,
        targetId: allyId,
        expectedVersion: encounter.version,
        attackType: 'melee',
      },
      userId,
    );
  };

  it('a raging Barbarian Strength melee hit adds +2 as its own Rage part, and the parts add to the total', async () => {
    await resetFight();
    const plain = await attackWithSeed(SEED);
    expect(plain.hit).toBe(true);

    await resetFight();
    expect(await claimRage(encounterId, barbarianId)).not.toBeNull();
    const raging = await attackWithSeed(SEED);
    expect(raging.hit).toBe(true);

    expect(raging.finalDamage).toBe(plain.finalDamage + 2);
    const parts = (raging as { damageParts?: Array<Record<string, unknown>> }).damageParts!;
    expect(parts.find((part) => part.source === 'Rage')).toMatchObject({
      amount: 2,
      damageType: 'slashing',
    });
    expect(parts.reduce((sum, part) => sum + (part.amount as number), 0)).toBe(raging.finalDamage);
  });

  it('a raging target takes half its slashing damage, and its racial fire resistance is kept', async () => {
    await resetFight();
    const plain = await attackWithSeed(SEED);
    expect(plain.hit).toBe(true);

    await resetFight();
    expect(await claimRage(encounterId, allyId)).not.toBeNull();
    const halved = await attackWithSeed(SEED);
    expect(halved.hit).toBe(true);

    expect(halved.finalDamage).toBe(Math.floor(plain.finalDamage / 2));
    const [ally] = await db
      .select({ resistances: combatParticipants.damageResistances })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, allyId));
    expect(ally.resistances).toEqual(['fire']);
  });

  /** Gives the ally the Paralyzed condition: a melee hit within 5 ft is then a critical (2014 SRD 5.1). */
  const paralyseAlly = async (): Promise<void> => {
    await db
      .insert(conditionsLibrary)
      .values({ name: 'Paralyzed', description: 'Paralyzed', mechanicalEffects: '{}' })
      .onConflictDoNothing();
    const [condition] = await db
      .select({ id: conditionsLibrary.id })
      .from(conditionsLibrary)
      .where(sql`lower(${conditionsLibrary.name}) = 'paralyzed'`)
      .limit(1);
    await db.insert(combatParticipantConditions).values({
      participantId: allyId,
      conditionId: condition.id,
      durationType: 'permanent',
      appliedAtRound: 1,
      isActive: true,
    });
  };

  it('Rage on a critical hit: the weapon dice double and the +2 is added once, not doubled', async () => {
    await paralyseAlly();
    try {
      await resetFight();
      const plain = await attackWithSeed(SEED);
      expect(plain.hit).toBe(true);
      expect(plain.autoCritReason).toBe('paralyzed');

      await resetFight();
      expect(await claimRage(encounterId, barbarianId)).not.toBeNull();
      const raging = await attackWithSeed(SEED);
      expect(raging.hit).toBe(true);
      expect(raging.autoCritReason).toBe('paralyzed');

      expect(raging.finalDamage).toBe(plain.finalDamage + 2);
      const parts = (raging as { damageParts?: Array<Record<string, unknown>> }).damageParts!;
      expect(parts.find((part) => part.source === 'Rage')).toMatchObject({ amount: 2 });
    } finally {
      await db
        .delete(combatParticipantConditions)
        .where(eq(combatParticipantConditions.participantId, allyId));
    }
  });

  it('a raging target whose racial resistance is the attack type takes half, once, not a quarter', async () => {
    await resetFight();
    const unresisted = await attackWithSeed(SEED);
    expect(unresisted.hit).toBe(true);

    await db
      .update(combatParticipants)
      .set({ damageResistances: ['slashing'] })
      .where(eq(combatParticipants.id, allyId));
    try {
      await resetFight();
      expect(await claimRage(encounterId, allyId)).not.toBeNull();
      const halved = await attackWithSeed(SEED);
      expect(halved.hit).toBe(true);

      expect(halved.finalDamage).toBe(Math.floor(unresisted.finalDamage / 2));
    } finally {
      await db
        .update(combatParticipants)
        .set({ damageResistances: ['fire'] })
        .where(eq(combatParticipants.id, allyId));
    }
  });

  it('a blow that drops a raging target to 0 HP ends its Rage, and the transcript says so', async () => {
    await resetFight();
    expect(await claimRage(encounterId, allyId)).not.toBeNull();
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 1 })
      .where(eq(combatParticipantStatus.participantId, allyId));

    const hit = await attackWithSeed(SEED);

    expect(hit.hit).toBe(true);
    expect(hit.transcriptLines).toContain("The Ally's rage ends.");
    expect(await isRaging(encounterId, allyId)).toBe(false);
  });
});
