/**
 * When Rage ends and what it resists (#1654), against a real Postgres.
 *
 * - Rage ends the moment the Barbarian drops to 0 HP (and so falls unconscious).
 * - Rage ends at the Barbarian's turn start when they neither attacked a hostile creature nor took
 *   damage since their last turn (2014 SRD 5.1). Damage or a hostile attack keeps it one more turn.
 * - A raging Barbarian resists bludgeoning, piercing and slashing from non-attack damage (hazards).
 *
 * The HP path is the production `CombatHPService.applyDamage`; the turn start is the production
 * `resetTurnResources`. No suite here calls the live DM. Requires TEST_DATABASE_URL or DATABASE_URL --
 * see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

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
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';

const { CombatHPService } = await importWithRealDb(() => import('../combat-hp-service.js'));
const { claimRage, isRaging } = await importWithRealDb(
  () => import('../combat/combat-turn-flags.js'),
);
const { resetTurnResources } = await importWithRealDb(
  () => import('../combat/combat-turn-resources.js'),
);
const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { setRngSeed } = await importWithRealDb(() => import('../../lib/rng.js'));

/** A seed on which the first attack hits an armour class of 1 (only a natural 1 misses). */
const SEED = 4242;

if (!hasRealDb) {
  console.warn('[barbarian-rage-ends] SKIPPED: set TEST_DATABASE_URL to run these.');
}

describeWithDb('When Rage ends and what it resists (#1654)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rage-ends-user');

  let campaignId: string;
  let barbarianCharacterId: string;
  let sessionId: string;
  let encounterId: string;
  let barbarianId: string;
  let goblinId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('rage-ends-camp') })
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

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: barbarianCharacterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    [{ id: barbarianId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId: barbarianCharacterId,
        name: 'The Barbarian',
        participantType: 'player',
        turnOrder: 0,
        initiative: 20,
        armorClass: 14,
        maxHp: 30,
        speed: 30,
      })
      .returning({ id: combatParticipants.id });

    await db.insert(combatParticipantStatus).values({
      participantId: barbarianId,
      currentHp: 30,
      maxHp: 30,
      isConscious: true,
    });

    // A hostile creature (not a player) for the attack that keeps Rage through a turn start.
    [{ id: goblinId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        name: 'A Hostile Goblin',
        participantType: 'monster',
        turnOrder: 1,
        initiative: 10,
        armorClass: 1,
        maxHp: 500,
        speed: 30,
      })
      .returning({ id: combatParticipants.id });
    await db.insert(combatParticipantStatus).values({
      participantId: goblinId,
      currentHp: 500,
      maxHp: 500,
      isConscious: true,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, barbarianCharacterId));
    await db.delete(characters).where(eq(characters.id, barbarianCharacterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  /** Back to round 1, no marks, full hit points. */
  const resetFight = async (): Promise<void> => {
    await db
      .update(combatEncounters)
      .set({ currentRound: 1, currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 30, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, barbarianId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 500, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, goblinId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
  };

  const damage = (amount: number, damageType: string) =>
    CombatHPService.applyDamage(
      barbarianId,
      encounterId,
      { damageAmount: amount, damageType: damageType as never, sourceDescription: 'a hazard' },
      userId,
    );

  it('Rage ends when the Barbarian drops to 0 HP and falls unconscious', async () => {
    await resetFight();
    expect(await claimRage(encounterId, barbarianId)).not.toBeNull();
    expect(await isRaging(encounterId, barbarianId)).toBe(true);

    // Fire, not slashing: Rage halves the physical types. Two hits of 15, because a player's single
    // hit is capped at half of max HP (hp-mechanics.ts), so one 30-point hit would stop at 15.
    await damage(15, 'fire');
    await damage(15, 'fire');

    const [status] = await db
      .select({
        currentHp: combatParticipantStatus.currentHp,
        isConscious: combatParticipantStatus.isConscious,
      })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, barbarianId));
    expect(status.currentHp).toBe(0);
    expect(status.isConscious).toBe(false);
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  it('damage that leaves the Barbarian standing does not end Rage', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);

    await damage(5, 'slashing');

    expect(await isRaging(encounterId, barbarianId)).toBe(true);
  });

  it('Rage ends at the Barbarian turn start when there was no attack on a hostile and no damage', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);

    await resetTurnResources(barbarianId, 2);

    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  it('an attack on a hostile creature keeps Rage through one turn start, then the next idle turn ends it', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);
    setRngSeed(SEED);
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });
    const attack = await combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: barbarianId,
        targetId: goblinId,
        expectedVersion: encounter.version,
        attackType: 'melee',
      },
      userId,
    );
    expect(attack.hit).toBe(true);

    await resetTurnResources(barbarianId, 2);
    expect(await isRaging(encounterId, barbarianId)).toBe(true);

    await resetTurnResources(barbarianId, 3);
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  it('damage taken in the turn keeps Rage through one turn start, then the next idle turn ends it', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);
    await damage(3, 'slashing');

    await resetTurnResources(barbarianId, 2);
    expect(await isRaging(encounterId, barbarianId)).toBe(true);

    await resetTurnResources(barbarianId, 3);
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  it('a raging Barbarian takes half of bludgeoning, piercing and slashing from a hazard, and all of fire', async () => {
    await resetFight();
    const unraged = await damage(10, 'bludgeoning');
    expect(unraged.modifiedDamage).toBe(10);

    for (const damageType of ['bludgeoning', 'piercing', 'slashing']) {
      await resetFight();
      await claimRage(encounterId, barbarianId);
      const result = await damage(10, damageType);
      expect(result.modifiedDamage).toBe(5);
    }

    await resetFight();
    await claimRage(encounterId, barbarianId);
    const fire = await damage(10, 'fire');
    expect(fire.modifiedDamage).toBe(10);
  });
});
