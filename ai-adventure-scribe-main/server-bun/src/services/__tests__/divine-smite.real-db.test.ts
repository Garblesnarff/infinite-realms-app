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
 * The d20 comes from Math.random, so the target's AC is moved instead of the die (same trick as
 * hex.real-db.test.ts): AC 1 is hit except on a natural 1, and AC 99 is missed except on a
 * natural 20. Each case retries a bounded number of times until the roll it needs comes up.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

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

  const usedSlots = async (): Promise<number> => {
    const [row] = await db
      .select({ usedSlots: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
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

  it('spends a level 1 slot on a hit and applies 2d8 radiant to the target', async () => {
    let outcome: Awaited<ReturnType<typeof attack>> | null = null;
    for (let i = 0; i < MAX_ATTEMPTS && !outcome; i++) {
      const version = await giveTurnToPaladin();
      const attempt = await attack(version, 1);
      if (attempt.hit) outcome = attempt;
    }
    expect(outcome).not.toBeNull();
    expect(await usedSlots()).toBe(1);

    const smite = (outcome as { divineSmiteDamage?: number }).divineSmiteDamage!;
    expect(smite).toBeGreaterThanOrEqual(2);
    expect(smite).toBeLessThanOrEqual(16);
    expect(outcome!.transcriptLines?.join('\n')).toContain('Divine Smite: 2d8 radiant');

    // The Smite lands on the orc's HP along with the weapon damage.
    expect(await orcHp()).toBeLessThanOrEqual(ORC_START_HP - smite);
  });

  it('adds 1d8 per slot level above 1st and 1d8 against undead', async () => {
    await db
      .update(combatParticipants)
      .set({ creatureType: 'undead' })
      .where(eq(combatParticipants.id, orcId));

    let outcome: { divineSmiteDamage?: number; transcriptLines?: string[] } | null = null;
    for (let i = 0; i < MAX_ATTEMPTS && !outcome; i++) {
      const version = await giveTurnToPaladin();
      const attempt = await attack(version, 2);
      if (attempt.hit) outcome = attempt;
    }
    expect(outcome).not.toBeNull();
    // Level 2 slot: 3d8, plus 1d8 against undead, so 4d8 in all.
    expect(outcome!.divineSmiteDamage!).toBeGreaterThanOrEqual(4);
    expect(outcome!.divineSmiteDamage!).toBeLessThanOrEqual(32);
    expect(outcome!.transcriptLines?.join('\n')).toContain('Divine Smite: 4d8 radiant');
  });

  it('refuses a Smite with no slot of that level, and nothing is spent or damaged', async () => {
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.insert(characterSpellSlots).values({
      characterId,
      spellLevel: 1,
      totalSlots: 0,
      usedSlots: 0,
    });

    let refusal: Error | null = null;
    for (let i = 0; i < MAX_ATTEMPTS && !refusal; i++) {
      const version = await giveTurnToPaladin();
      try {
        // A hit is the only path that spends a slot, so a resolved attack here is a miss.
        await attack(version, 1);
      } catch (error) {
        refusal = error as Error;
      }
    }

    expect(refusal).not.toBeNull();
    expect(refusal!.message).toContain('Divine Smite refused');
    expect(await usedSlots()).toBe(0);
    expect(await orcHp()).toBe(ORC_START_HP);
  });

  it('a miss spends no slot and applies no Smite', async () => {
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
