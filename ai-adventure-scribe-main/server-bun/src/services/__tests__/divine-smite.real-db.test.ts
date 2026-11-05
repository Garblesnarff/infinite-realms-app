/* eslint-disable max-lines -- one fixture chain (campaign -> paladin -> session -> encounter ->
   participants -> slots) shared by every assertion; splitting it would build the encounter twice. */
/**
 * Divine Smite on a melee hit (#1362, 2014 PHB p.85), against a real Postgres.
 *
 * The attack resolver is the production code: the slot is spent through SpellSlotsService, the
 * Smite damage is rolled and written to the target's HP, and a refusal releases the action
 * claim. A mocked `db` cannot show the slot row or the HP row, so this suite runs against the
 * scratch database. Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 *
 * The target's AC selects the intended hit/miss path, with bounded retries. The damage-bound
 * cases seed the engine's dice to exercise both normal and critical hits deterministically.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterSpellSlots,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';

const combatAttackService = hasRealDb
  ? (await import('../combat/combat-attack-service.js')).combatAttackService
  : undefined;

if (!hasRealDb) {
  console.warn('[divine-smite] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

const UNMISSABLE_AC = 1;
const UNHITTABLE_AC = 99;
const MAX_ATTEMPTS = 40;
const ORC_START_HP = 500;

describeWithDb('Divine Smite on a melee hit (#1362)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('smite-user');
  afterEach(() => setRngSeed(undefined));

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let paladinId: string;
  let orcId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('smite-camp') })
      .returning({ id: campaigns.id });

    // Paladin 5, STR 16, a Longsword in hand: a melee weapon attack with a Smite to spend.
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('paladin'),
        level: 5,
        class: 'Paladin',
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      charisma: 14,
      armorClass: 16,
      maxHitPoints: 40,
      currentHitPoints: 40,
      speed: 30,
    });

    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

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
          name: 'The Paladin',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 16,
          maxHp: 40,
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

    paladinId = inserted.find((row) => row.turnOrder === 0)!.id;
    orcId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: paladinId, currentHp: 40, maxHp: 40, isConscious: true },
      { participantId: orcId, currentHp: ORC_START_HP, maxHp: ORC_START_HP, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  /** Fresh slots, a fresh orc, and the paladin's class restored before every case. */
  beforeEach(async () => {
    if (!hasRealDb) return;
    await db.update(characters).set({ class: 'Paladin' }).where(eq(characters.id, characterId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.insert(characterSpellSlots).values({
      characterId,
      spellLevel: 1,
      totalSlots: 2,
      usedSlots: 0,
    });
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: ORC_START_HP, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, orcId));
    await db
      .update(combatParticipants)
      .set({ armorClass: UNMISSABLE_AC, creatureType: null })
      .where(eq(combatParticipants.id, orcId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 40, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, paladinId));
  });

  /** Hands the turn to the paladin, refunds the action, and returns the version to claim. */
  const giveTurnToPaladin = async (): Promise<number> => {
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

  // Reads one slot level. The check derives the paladin's other slot levels from class
  // progression, so a read without a level filter can return a level 2 row.
  const usedSlots = async (spellLevel = 1): Promise<number> => {
    const [row] = await db
      .select({ usedSlots: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, spellLevel),
        ),
      );
    return row?.usedSlots ?? 0;
  };

  const orcHp = async (): Promise<number> => {
    const [row] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, orcId));
    return row.currentHp;
  };

  const attack = (expectedVersion: number, divineSmiteSlotLevel?: number) =>
    combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: paladinId,
        targetId: orcId,
        expectedVersion,
        attackType: 'melee',
        ...(divineSmiteSlotLevel !== undefined ? { divineSmiteSlotLevel } : {}),
      },
      userId,
    );

  it.each([
    [1, false],
    [36, true],
  ])('spends a level 1 slot on a hit (seed %i)', async (seed, critical) => {
    setRngSeed(seed);
    let outcome: Awaited<ReturnType<typeof attack>> | null = null;
    for (let i = 0; i < MAX_ATTEMPTS && !outcome; i++) {
      const version = await giveTurnToPaladin();
      const attempt = await attack(version, 1);
      if (attempt.hit) outcome = attempt;
    }
    expect(outcome).not.toBeNull();
    expect(await usedSlots()).toBe(1);
    expect(outcome!.isCritical).toBe(critical);

    const smite = (outcome as { divineSmiteDamage?: number }).divineSmiteDamage!;
    const dice = outcome!.isCritical ? 4 : 2;
    expect(smite).toBeGreaterThanOrEqual(dice);
    expect(smite).toBeLessThanOrEqual(dice * 8);
    expect(outcome!.transcriptLines?.join('\n')).toContain(`Divine Smite: ${dice}d8 radiant`);

    // The Smite lands on the orc's HP along with the weapon damage.
    expect(await orcHp()).toBeLessThanOrEqual(ORC_START_HP - smite);
  });

  it.each([
    [1, false],
    [36, true],
  ])(
    'adds 1d8 per slot level above 1st and 1d8 against undead (seed %i)',
    async (seed, critical) => {
      setRngSeed(seed);
      // No level 2 row is seeded: the paladin's level-2 slots come from class progression, the
      // same derivation the spend path uses for a character created before its rows existed.
      await db
        .update(combatParticipants)
        .set({ creatureType: 'undead' })
        .where(eq(combatParticipants.id, orcId));

      let outcome: Awaited<ReturnType<typeof attack>> | null = null;
      for (let i = 0; i < MAX_ATTEMPTS && !outcome; i++) {
        const version = await giveTurnToPaladin();
        const attempt = await attack(version, 2);
        if (attempt.hit) outcome = attempt;
      }
      expect(outcome).not.toBeNull();
      expect(outcome!.isCritical).toBe(critical);
      // Level 2 slot: 3d8 plus 1d8 against undead, doubled on a critical hit.
      const dice = outcome!.isCritical ? 8 : 4;
      const smite = (outcome as { divineSmiteDamage?: number }).divineSmiteDamage!;
      expect(smite).toBeGreaterThanOrEqual(dice);
      expect(smite).toBeLessThanOrEqual(dice * 8);
      expect(outcome!.transcriptLines?.join('\n')).toContain(`Divine Smite: ${dice}d8 radiant`);
      expect(await usedSlots(2)).toBe(1);
    },
  );

  it('refuses a Smite with no slot of that level before any roll, claim or spend', async () => {
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.insert(characterSpellSlots).values({
      characterId,
      spellLevel: 1,
      totalSlots: 0,
      usedSlots: 0,
    });
    const version = await giveTurnToPaladin();

    // Math.random is the only source of the d20 and of the dice: a refusal that rolled would
    // have drawn from it.
    const realRandom = Math.random;
    let draws = 0;
    Math.random = () => {
      draws += 1;
      return realRandom();
    };
    try {
      await expect(attack(version, 1)).rejects.toThrow(
        'Divine Smite refused: no level 1 spell slot left',
      );
    } finally {
      Math.random = realRandom;
    }

    expect(draws).toBe(0);
    expect(await usedSlots()).toBe(0);
    expect(await orcHp()).toBe(ORC_START_HP);
    // The claim was never taken, so the Paladin still has the action.
    const [paladin] = await db
      .select({ actionUsed: combatParticipants.actionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, paladinId));
    expect(paladin.actionUsed).toBe(false);
  });

  it('a spend that fails on a hit lands the weapon damage without the Smite', async () => {
    setRngSeed(1);
    const { SpellSlotsService } = await import('../spell-slots-service.js');
    const realUse = SpellSlotsService.useSpellSlot;
    // The slot passes the up-front check, then another spend takes it before this hit.
    SpellSlotsService.useSpellSlot = async () => {
      const { BusinessLogicError } = await import('../../lib/errors.js');
      throw new BusinessLogicError('No available level 1 spell slots', {});
    };
    try {
      let outcome: Awaited<ReturnType<typeof attack>> | null = null;
      for (let i = 0; i < MAX_ATTEMPTS && !outcome; i++) {
        const version = await giveTurnToPaladin();
        const attempt = await attack(version, 1);
        if (attempt.hit) outcome = attempt;
      }
      expect(outcome).not.toBeNull();
      expect((outcome as { divineSmiteDamage?: number }).divineSmiteDamage).toBeUndefined();
      expect(outcome!.transcriptLines).toContain('Divine Smite not applied: no level 1 slot.');
      expect(await orcHp()).toBeLessThan(ORC_START_HP);
    } finally {
      SpellSlotsService.useSpellSlot = realUse;
    }
    expect(await usedSlots()).toBe(0);
  });

  it('a miss spends no slot and applies no Smite', async () => {
    setRngSeed(1);
    await db
      .update(combatParticipants)
      .set({ armorClass: UNHITTABLE_AC })
      .where(eq(combatParticipants.id, orcId));

    let missed = false;
    for (let i = 0; i < MAX_ATTEMPTS && !missed; i++) {
      const version = await giveTurnToPaladin();
      const attempt = await attack(version, 1);
      if (!attempt.hit) missed = true;
      else
        await db
          .update(combatParticipantStatus)
          .set({ currentHp: ORC_START_HP })
          .where(eq(combatParticipantStatus.participantId, orcId));
    }

    expect(missed).toBe(true);
    expect(await usedSlots()).toBe(0);
  });

  it('refuses a Smite from a character who is not a Paladin before anything is spent', async () => {
    await db.update(characters).set({ class: 'Fighter' }).where(eq(characters.id, characterId));
    const version = await giveTurnToPaladin();

    await expect(attack(version, 1)).rejects.toThrow('only a Paladin can smite');
    expect(await usedSlots()).toBe(0);
    expect(await orcHp()).toBe(ORC_START_HP);
  });
});
