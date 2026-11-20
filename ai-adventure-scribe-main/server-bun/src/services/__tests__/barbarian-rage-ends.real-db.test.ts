/**
 * When Rage ends and what it resists (#1654), against a real Postgres.
 *
 * - Rage ends the moment the Barbarian drops to 0 HP (and so falls unconscious).
 * - Rage ends at the END of the Barbarian's turn, once the advance is written, when they neither attacked a
 *   hostile creature nor took damage since their last turn (2014 SRD 5.1). The engine says so in one line.
 * - A raging Barbarian resists bludgeoning, piercing and slashing from non-attack damage (hazards).
 *
 * The HP path is the production `CombatHPService.applyDamage`; the turn end is the production
 * `CombatInitiativeService.advanceTurn`. No suite here calls the live DM. Requires TEST_DATABASE_URL or
 * DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, spyOn } from 'bun:test';
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
import { setRngSeed } from '../../lib/rng.js';

const { CombatHPService } = await importWithRealDb(() => import('../combat-hp-service.js'));
const { CombatInitiativeService } = await importWithRealDb(
  () => import('../combat-initiative-service.js'),
);
const combatTurnFlags = await importWithRealDb(() => import('../combat/combat-turn-flags.js'));
const { claimRage, clearRage, isRaging } = combatTurnFlags;
const { logger } = await importWithRealDb(() => import('../../lib/logger.js'));
const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { applyNonAttackDamage } = await importWithRealDb(
  () => import('../combat/non-attack-damage.js'),
);

if (!hasRealDb) {
  console.warn('[barbarian-rage-ends] SKIPPED: set TEST_DATABASE_URL to run these.');
}

/** A seed on which the first attack hits an armour class of 1 (only a natural 1 misses). */
const SEED = 4242;

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

    // A hostile creature (not a player): the attack target, and the next turn in the order.
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

  /** Back to round 1, the Barbarian's turn, no marks, full hit points, a fresh action economy. */
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
      .set({ currentHp: 30, isConscious: true, tempHp: 0 })
      .where(eq(combatParticipantStatus.participantId, barbarianId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 500, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, goblinId));
  };

  /** Points the order back at the Barbarian, so the next advance ends the Barbarian's turn. */
  const barbarianTurnNow = async (): Promise<void> => {
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
  };

  /** The Barbarian's turn ends: the order advances (to the goblin), through the production advance. */
  const endBarbarianTurn = () => CombatInitiativeService!.advanceTurn(encounterId);

  const damage = (amount: number, damageType: string) =>
    CombatHPService.applyDamage(
      barbarianId,
      encounterId,
      { damageAmount: amount, damageType: damageType as never, sourceDescription: 'a hazard' },
      userId,
    );

  /** One attack on the goblin, with a fixed seed. The Barbarian's turn must be current. */
  const attackGoblin = async () => {
    setRngSeed(SEED);
    await barbarianTurnNow();
    const [encounter] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: barbarianId,
        targetId: goblinId,
        expectedVersion: encounter.version,
        attackType: 'melee',
      },
      userId,
    );
  };

  it('a turn that ends with no attack and no damage ends Rage, and the engine says so', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);
    expect(await isRaging(encounterId, barbarianId)).toBe(true);

    const turn = await endBarbarianTurn();

    expect(await isRaging(encounterId, barbarianId)).toBe(false);
    expect(turn.engineLines).toEqual(["The Barbarian's rage ends."]);
  });

  it('a turn that ends after an attack on a hostile creature keeps Rage; the next idle turn ends it', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);
    expect((await attackGoblin()).hit).toBe(true);

    const kept = await endBarbarianTurn();
    expect(await isRaging(encounterId, barbarianId)).toBe(true);
    expect(kept.engineLines).toEqual([]);

    await barbarianTurnNow();
    const ended = await endBarbarianTurn();
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
    expect(ended.engineLines).toEqual(["The Barbarian's rage ends."]);
  });

  it('damage taken during the turn keeps Rage through its end', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);
    await damage(3, 'fire');

    const turn = await endBarbarianTurn();

    expect(await isRaging(encounterId, barbarianId)).toBe(true);
    expect(turn.engineLines).toEqual([]);
  });

  it('damage absorbed by temporary HP counts as damage taken and keeps Rage', async () => {
    await resetFight();
    await db
      .update(combatParticipantStatus)
      .set({ tempHp: 5 })
      .where(eq(combatParticipantStatus.participantId, barbarianId));
    await claimRage(encounterId, barbarianId);
    const hit = await damage(3, 'fire');
    expect(hit.modifiedDamage).toBe(0);
    expect(hit.tempHpLost).toBe(3);

    await endBarbarianTurn();

    expect(await isRaging(encounterId, barbarianId)).toBe(true);
  });

  it('a refused turn advance (the turn has moved on) ends no Rage', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);

    await expect(
      CombatInitiativeService!.advanceTurn(encounterId, undefined, { round: 9, turnOrder: 9 }),
    ).rejects.toThrow('The turn has already moved on');

    expect(await isRaging(encounterId, barbarianId)).toBe(true);
  });

  it('a fall to 0 HP ends Rage at once, and the damage result says so', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);

    // Fire, not slashing: Rage halves the physical types. Two hits of 15, because a player's single
    // hit is capped at half of max HP (hp-mechanics.ts), so one 30-point hit would stop at 15.
    const first = await damage(15, 'fire');
    expect(first.rageEnded).toBe(false);
    const second = await damage(15, 'fire');

    expect(second.rageEnded).toBe(true);
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

  it('a fall by a creature that is not raging ends nothing, and clearing an absent Rage writes nothing', async () => {
    await resetFight();

    await damage(15, 'fire');
    const fall = await damage(15, 'fire');

    expect(fall.rageEnded).toBe(false);
    expect(await clearRage(encounterId, barbarianId)).toBe(false);
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  it('hazard damage is halved for bludgeoning, piercing and slashing, and fire is not', async () => {
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

  it('a hazard that drops a raging Barbarian to 0 HP ends Rage, and the player and the DM are told', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);

    const result = await applyNonAttackDamage(barbarianCharacterId, userId, 30, 'a rockfall', {
      damageType: 'fire',
    });

    expect(await isRaging(encounterId, barbarianId)).toBe(false);
    expect(result.engineLines).toContain("The Barbarian's rage ends.");
  });

  it('a failed turn-end check does not fail the turn: it is logged, and no line is written', async () => {
    await resetFight();
    await claimRage(encounterId, barbarianId);
    const error = spyOn(logger, 'error');
    const check = spyOn(combatTurnFlags, 'endRageIfIdle').mockRejectedValueOnce(
      new Error('check write failed'),
    );
    try {
      const turn = await endBarbarianTurn();

      expect(turn.currentParticipant.id).toBe(goblinId);
      expect(turn.engineLines).toEqual([]);
      expect(
        error.mock.calls.some((call) =>
          JSON.stringify(call).includes('RAGE_TURN_END_CHECK_FAILED'),
        ),
      ).toBe(true);
    } finally {
      check.mockRestore();
      error.mockRestore();
    }
  });
});
