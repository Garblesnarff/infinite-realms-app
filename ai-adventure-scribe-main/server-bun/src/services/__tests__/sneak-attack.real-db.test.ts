/**
 * Sneak Attack (#1637, 2014 SRD 5.1) and the hidden attacker (#1637), against a real Postgres.
 *
 * The attack resolver is the production code. The rider's once-per-round mark, the Hide mark and
 * the mark's clearing all live in `game_sessions.session_state`, which a mocked `db` cannot show,
 * so this suite runs against the scratch database. Requires TEST_DATABASE_URL or DATABASE_URL --
 * see fixtures/real-db.ts. No suite here calls the live DM.
 *
 * The target's AC of 1 makes almost every attack a hit. Advantage comes from the hidden mark (an
 * engine source) or from the explicit disadvantage input; the client "requested" flag is covered too.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';

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
  inventoryItems,
  tacticalMaps,
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';
import { describeResolvedAttack } from '../combat/attack-narration.js';
// The engine modules reach the database client when they load, so they load only with a database.
const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { CombatHPService } = await importWithRealDb(() => import('../combat-hp-service.js'));
const { executeCombatCheck } = await importWithRealDb(
  () => import('../combat/combat-check-service.js'),
);
const { saveTacticalMap } = await importWithRealDb(() => import('../combat/tactical-map-store.js'));
const { resetTurnResources } = await importWithRealDb(
  () => import('../combat/combat-turn-resources.js'),
);
const {
  clearHiddenForEncounter,
  combatTurnFlagsPreservingState,
  isHiddenAttacker,
  isSneakAttackSpent,
  markHiddenAttacker,
} = await importWithRealDb(() => import('../combat/combat-turn-flags.js'));

if (!hasRealDb) {
  console.warn('[sneak-attack] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

const UNMISSABLE_AC = 1;
const ORC_START_HP = 500;
const MAX_ATTEMPTS = 60;

describeWithDb('Sneak Attack and the hidden attacker (#1637)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('sneak-user');
  afterEach(() => setRngSeed(undefined));

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let rogueId: string;
  let orcId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('sneak-camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('rogue'), level: 1, class: 'Rogue' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 10,
      dexterity: 16,
      charisma: 10,
      armorClass: 14,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });

    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Rapier', itemType: 'weapon', isEquipped: true });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
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
          characterId,
          name: 'The Rogue',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 14,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          name: 'Orc',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: UNMISSABLE_AC,
          maxHp: ORC_START_HP,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    rogueId = inserted.find((row) => row.turnOrder === 0)!.id;
    orcId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: rogueId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: orcId, currentHp: ORC_START_HP, maxHp: ORC_START_HP, isConscious: true },
    ]);
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

  /** A fresh round, a fresh orc, a Rogue of level 1 with no leftover session flags. */
  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .update(characters)
      .set({ class: 'Rogue', level: 1 })
      .where(eq(characters.id, characterId));
    await db
      .update(combatEncounters)
      .set({ currentRound: 1, currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: ORC_START_HP, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, orcId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 30, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, rogueId));
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
  });

  /** Hands the turn to the Rogue (refunds the action) and returns the version to claim. */
  const giveTurnToRogue = async (): Promise<number> => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });
    return encounter.version;
  };

  const setRound = async (round: number): Promise<void> => {
    await db
      .update(combatEncounters)
      .set({ currentRound: round })
      .where(eq(combatEncounters.id, encounterId));
  };

  const sessionState = async (): Promise<Record<string, any>> => {
    const [row] = await db
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    return (row?.state ?? {}) as Record<string, any>;
  };

  const attack = (
    expectedVersion: number,
    extra: { advantage?: boolean; disadvantage?: boolean; providedD20?: number } = {},
  ) =>
    combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: rogueId,
        targetId: orcId,
        expectedVersion,
        attackType: 'melee',
        ...extra,
      },
      userId,
    );

  /**
   * Attacks until one hits. With `hidden`, the Hide mark is set before every try, because the
   * attack spends it. With `newRoundEachTry`, each try is its own round so the once-per-round
   * mark never hides a later hit (used where the test needs a critical hit).
   */
  const attackUntilHit = async (
    options: {
      hidden?: boolean;
      newRoundEachTry?: boolean;
      untilCritical?: boolean;
      extra?: { advantage?: boolean; disadvantage?: boolean };
    } = {},
  ) => {
    let round = 1;
    for (let i = 0; i < MAX_ATTEMPTS * 8; i++) {
      if (options.newRoundEachTry) {
        round += 1;
        await setRound(round);
      }
      if (options.hidden) await markHiddenAttacker(encounterId, rogueId);
      const version = await giveTurnToRogue();
      const outcome = await attack(version, options.extra);
      if (outcome.hit && (!options.untilCritical || outcome.isCritical)) return outcome;
    }
    throw new Error('no qualifying hit in the attempt budget');
  };

  it('adds ⌈level/2⌉d6 of the weapon type on a hit with hidden advantage, once', async () => {
    const outcome = await attackUntilHit({ hidden: true });

    expect(outcome.advantage).toBe(true);
    expect(outcome.advantage).toBe(true);
    // A natural 20 is a critical hit and doubles the rider's dice (the RNG is not seeded here).
    expect(outcome.sneakAttackDice).toBe(outcome.isCritical ? '2d6' : '1d6');
    const rider = outcome.sneakAttackDamage!;
    expect(rider).toBeGreaterThanOrEqual(outcome.isCritical ? 2 : 1);
    expect(rider).toBeLessThanOrEqual(outcome.isCritical ? 12 : 6);

    const parts = (outcome as { damageParts?: Array<Record<string, unknown>> }).damageParts!;
    expect(parts.map((part) => part.damageType)).toEqual(['piercing', 'piercing']);
    expect(parts[1]).toMatchObject({
      amount: rider,
      source: 'Sneak Attack',
      dice: outcome.sneakAttackDice,
    });
    expect(parts.reduce((sum, part) => sum + (part.amount as number), 0)).toBe(outcome.finalDamage);
    expect(outcome.transcriptLines?.join('\n')).toContain(
      `Sneak Attack: ${outcome.sneakAttackDice} piercing`,
    );

    // The DM and the engine line read the split the same way the Smite line does.
    const line = describeResolvedAttack('The Rogue', 'The Orc', outcome);
    expect(line).toContain(
      `${parts[0].amount} piercing + ${rider} piercing (Sneak Attack ${outcome.sneakAttackDice}) = ${outcome.finalDamage} damage`,
    );

    // The mark is spent for this round.
    expect(await isSneakAttackSpent(encounterId, rogueId, 1)).toBe(true);
  });

  it('does not add the rider a second time in the same turn', async () => {
    await attackUntilHit({ hidden: true });
    const second = await attackUntilHit({ hidden: true });

    expect(second.advantage).toBe(true);
    expect(second.sneakAttackDice).toBeUndefined();
    expect(
      (second as { damageParts?: Array<Record<string, unknown>> }).damageParts?.some(
        (part) => part.source === 'Sneak Attack',
      ),
    ).toBeFalsy();
  });

  it('adds the rider again on the next turn', async () => {
    await attackUntilHit({ hidden: true });
    await setRound(2);
    const nextTurn = await attackUntilHit({ hidden: true });

    expect(nextTurn.sneakAttackDice).toMatch(/^[12]d6$/);
    expect(nextTurn.sneakAttackDamage).toBeDefined();
  });

  it('clears the once-per-turn mark at turn reset', async () => {
    await attackUntilHit({ hidden: true });
    expect(await isSneakAttackSpent(encounterId, rogueId, 1)).toBe(true);

    await resetTurnResources(rogueId, 2);

    expect(await isSneakAttackSpent(encounterId, rogueId, 1)).toBe(false);
    expect((await sessionState()).sneakAttackSpent?.[rogueId]).toBeUndefined();
  });

  it('names the hidden source on the proposal, and the requested flag stays a requested source', async () => {
    await markHiddenAttacker(encounterId, rogueId);
    const proposal = await combatAttackService!.proposeAttack(
      encounterId,
      { attackerId: rogueId, targetId: orcId, expectedVersion: 0, attackType: 'melee' },
      userId,
    );
    expect(proposal.advantageSources).toEqual(['hidden']);
    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(true);

    const requested = await combatAttackService!.proposeAttack(
      encounterId,
      {
        attackerId: rogueId,
        targetId: orcId,
        expectedVersion: 0,
        attackType: 'melee',
        advantage: true,
      },
      userId,
    );
    expect(requested.advantageSources).toContain('requested');
  });

  it('adds nothing with no advantage and no ally', async () => {
    const outcome = await attackUntilHit();

    expect(outcome.advantage).toBe(false);
    expect(outcome.sneakAttackDice).toBeUndefined();
    expect(outcome.sneakAttackDamage).toBeUndefined();
  });

  it('does not count the client "requested" advantage flag alone', async () => {
    const outcome = await attackUntilHit({ extra: { advantage: true } });

    expect(outcome.advantage).toBe(true);
    expect(outcome.sneakAttackDice).toBeUndefined();
  });

  it('adds nothing with disadvantage', async () => {
    const outcome = await attackUntilHit({ extra: { disadvantage: true } });

    expect(outcome.disadvantage).toBe(true);
    expect(outcome.sneakAttackDice).toBeUndefined();
  });

  it('is only for a Rogue: a Fighter with hidden advantage gets no rider', async () => {
    await db.update(characters).set({ class: 'Fighter' }).where(eq(characters.id, characterId));

    const outcome = await attackUntilHit({ hidden: true });

    expect(outcome.advantage).toBe(true);
    expect(outcome.sneakAttackDice).toBeUndefined();
  });

  it('doubles the dice on a critical hit', async () => {
    const outcome = await attackUntilHit({
      hidden: true,
      newRoundEachTry: true,
      untilCritical: true,
    });

    expect(outcome.isCritical).toBe(true);
    expect(outcome.sneakAttackDice).toBe('2d6');
    expect(outcome.sneakAttackDamage!).toBeGreaterThanOrEqual(2);
    expect(outcome.sneakAttackDamage!).toBeLessThanOrEqual(12);
  });

  it('uses ⌈level/2⌉ dice for a higher-level Rogue (level 5 = 3d6)', async () => {
    await db.update(characters).set({ level: 5 }).where(eq(characters.id, characterId));

    const outcome = await attackUntilHit({ hidden: true });

    expect(outcome.sneakAttackDice).toBe(outcome.isCritical ? '6d6' : '3d6');
    expect(outcome.sneakAttackDamage!).toBeGreaterThanOrEqual(outcome.isCritical ? 6 : 3);
    expect(outcome.sneakAttackDamage!).toBeLessThanOrEqual(outcome.isCritical ? 36 : 18);
  });

  it('a Hide mark gives advantage and the rider, then the attack clears it', async () => {
    const outcome = await attackUntilHit({ hidden: true });

    expect(outcome.advantage).toBe(true);
    expect(outcome.sneakAttackDice).toBe(outcome.isCritical ? '2d6' : '1d6');
    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(false);
    expect((await sessionState()).hiddenParticipants?.[rogueId]).toBeUndefined();
  });

  it('taking damage clears a Hide mark', async () => {
    await markHiddenAttacker(encounterId, rogueId);
    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(true);

    await CombatHPService.applyDamage(
      rogueId,
      encounterId,
      {
        damageAmount: 1,
        damageType: 'bludgeoning',
        sourceParticipantId: orcId,
        sourceDescription: 'test strike',
      },
      userId,
    );

    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(false);
  });

  it('the end of the fight clears every Hide mark of that fight', async () => {
    await markHiddenAttacker(encounterId, rogueId);

    await clearHiddenForEncounter(db, encounterId);

    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(false);
  });

  it('a client whole-blob session write keeps both engine flags', async () => {
    await markHiddenAttacker(encounterId, rogueId);
    await db
      .update(gameSessions)
      .set({
        sessionState: sql`${combatTurnFlagsPreservingState(sql`'{}'::jsonb`)}`,
      })
      .where(and(eq(gameSessions.id, sessionId)));

    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(true);
  });
  it('a Hide check that succeeds marks the attacker, and the next attack has the advantage and the rider', async () => {
    const version = await giveTurnToRogue();
    // A natural 20 on the Hide roll. With no hostile watching, the DC is 0 and the check cannot fail.
    const check = await executeCombatCheck(
      {
        encounterId,
        intent: { kind: 'hide', verb: 'hide' },
        actorId: rogueId,
        userId,
        expectedVersion: version,
      },
      () => 20,
    );
    expect(check.success).toBe(true);
    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(true);

    // The player's own d20 of 15 (+5 to hit) hits AC 1 every time, so the rider is deterministic.
    const outcome = await attack(await giveTurnToRogue(), { providedD20: 15 });

    expect(outcome.hit).toBe(true);
    expect(outcome.advantage).toBe(true);
    expect(outcome.sneakAttackDice).toBe('1d6');
    expect(await isHiddenAttacker(encounterId, rogueId)).toBe(false);
  });

  it('a flanking ally within 5 ft of the target adds the rider, and one beyond 5 ft adds none', async () => {
    // A companion on the Rogue's side, placed on a real tactical map. Rogue at x=2, orc at x=3
    // (5 ft apart, so the Rapier reaches), companion at x=4 (5 ft from the orc).
    const [{ id: companionId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        name: 'Companion',
        participantType: 'player',
        turnOrder: 2,
        initiative: 5,
        armorClass: 12,
        maxHp: 20,
        speed: 30,
      })
      .returning({ id: combatParticipants.id });
    await db.insert(combatParticipantStatus).values({
      participantId: companionId,
      currentHp: 20,
      maxHp: 20,
      isConscious: true,
    });
    const cells = Array.from({ length: 5 }, () =>
      Array.from({ length: 12 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as 0 | 1 | 2 | 3,
        elevation: 0,
      })),
    );
    const placeMap = async (companionX: number) =>
      saveTacticalMap!({
        id: crypto.randomUUID(),
        sessionId,
        width: 12,
        height: 5,
        cells,
        entities: [
          {
            id: rogueId,
            slug: 'the-rogue',
            x: 2,
            y: 2,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: orcId,
            slug: 'the-orc',
            x: 3,
            y: 2,
            size: 'medium' as const,
            type: 'monster' as const,
            speedFeet: 30,
            movementRemaining: 30,
          },
          {
            id: companionId,
            slug: 'the-companion',
            x: companionX,
            y: 2,
            size: 'medium' as const,
            type: 'pc' as const,
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
      } as never);

    try {
      // Within 5 ft of the orc: the ally clause applies, with no advantage at all.
      await placeMap(4);
      const near = await attack(await giveTurnToRogue(), { providedD20: 15 });
      expect(near.hit).toBe(true);
      expect(near.advantage).toBe(false);
      expect(near.sneakAttackDice).toBe('1d6');

      // Beyond 5 ft of the orc (x=9 is 6 cells away): no rider, next round so the once-per-round mark is clear.
      await setRound(2);
      await placeMap(9);
      const far = await attack(await giveTurnToRogue(), { providedD20: 15 });
      expect(far.hit).toBe(true);
      expect(far.sneakAttackDice).toBeUndefined();
    } finally {
      await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
      await db.delete(combatParticipants).where(eq(combatParticipants.id, companionId));
    }
  });
});
