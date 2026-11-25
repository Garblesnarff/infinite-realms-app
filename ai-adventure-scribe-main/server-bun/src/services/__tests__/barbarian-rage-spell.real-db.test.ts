/**
 * Rage on a spell (#1654), against a real Postgres: a raging target takes the full amount from a fire spell.
 *
 * Not covered here: the half-damage case for bludgeoning, piercing and slashing spells. The combat engine's
 * damaging spell list (PLAYER_COMBAT_SPELL_IDS, src/data/spellData.ts) has no physical-damage spell, so such a
 * cast is refused before it resolves.
 *
 * The caster is a Sorcerer (CHA 16, so DC 14). Burning Hands is a DEX save for half. The target's saves are set low, so each save fails, and
 * the same seed drives both casts, so the only difference is the Rage term. The production
 * `resolveSpellAttack` runs against the database. No suite here calls the live DM. Requires
 * TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
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
  characterConcentration,
  characterStats,
  characters,
  characterSpellSlots,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';
import { mulberry32, setRngSeed } from '../../lib/rng.js';

const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { claimRage } = await importWithRealDb(() => import('../combat/combat-turn-flags.js'));

const { rollCombatSavingThrow } = await importWithRealDb(
  () => import('../combat/combat-saving-throw.js'),
);
const { maybeStartConcentrationFromSpellCast } = await importWithRealDb(
  () => import('../combat/spell-cast-concentration.js'),
);

if (!hasRealDb) {
  console.warn('[barbarian-rage-spell] SKIPPED: set TEST_DATABASE_URL to run these.');
}

const SEED = 9001;

describeWithDb('Rage on a spell (#1654)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rage-spell-user');

  let campaignId: string;
  let casterCharacterId: string;
  let targetCharacterId: string;
  let sessionId: string;
  let encounterId: string;
  let casterId: string;
  let targetId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('rage-spell-camp') })
      .returning({ id: campaigns.id });

    [{ id: casterCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('sorcerer'),
        level: 5,
        class: 'Sorcerer',
        knownSpells: 'Burning Hands,Dancing Lights',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: casterCharacterId,
      strength: 10,
      dexterity: 12,
      charisma: 16,
      armorClass: 12,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });

    // A target whose saves fail: DEX and STR 1 (-5), against DC 14.
    [{ id: targetCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('raging-target'),
        level: 3,
        class: 'Barbarian',
        classLevels: [{ className: 'Barbarian', level: 3 }],
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: targetCharacterId,
      strength: 1,
      dexterity: 1,
      charisma: 10,
      armorClass: 1,
      maxHitPoints: 200,
      currentHitPoints: 200,
      speed: 30,
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: casterCharacterId, sessionNumber: 1, status: 'active' })
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
          characterId: casterCharacterId,
          name: 'The Sorcerer',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          characterId: targetCharacterId,
          name: 'The Raging Target',
          participantType: 'player',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 200,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    casterId = inserted.find((row) => row.turnOrder === 0)!.id;
    targetId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: casterId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: targetId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, casterCharacterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, casterCharacterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, targetCharacterId));
    await db.delete(characters).where(eq(characters.id, casterCharacterId));
    await db.delete(characters).where(eq(characters.id, targetCharacterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, casterCharacterId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 200, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, targetId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
  });

  /** The caster's turn is current; returns the version to claim. */
  const giveTurnToCaster = async (): Promise<number> => {
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });
    return encounter.version;
  };

  /** Casts a save spell at the target with a fixed seed, and returns the target's result. */
  const castAtTarget = async (spellId: string, spellName: string, slotLevel: number) => {
    setRngSeed(SEED);
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    const resolution = await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId,
        targetIds: [targetId],
        spellId,
        spellName,
        slotLevel,
        expectedVersion: await giveTurnToCaster(),
      },
      userId,
    );
    return resolution.results[0];
  };

  it('a raging target takes the full amount from fire (Burning Hands): Rage resists only bludgeoning, piercing and slashing', async () => {
    // The same seed gives the same save outcome in both casts, so the damage is comparable.
    const plainFire = await castAtTarget('burning-hands', 'Burning Hands', 1);
    expect(plainFire.finalDamage).toBeGreaterThan(0);

    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    expect(await claimRage(encounterId, targetId)).not.toBeNull();
    const ragingFire = await castAtTarget('burning-hands', 'Burning Hands', 1);

    expect(ragingFire.finalDamage).toBe(plainFire.finalDamage);
  });
  it('keeps the higher Strength save die during Rage and uses one die for Dexterity', async () => {
    // Select a seed whose second roll is higher, so one die would fail the assertion.
    const seed = Array.from({ length: 100 }, (_, index) => index).find((candidate) => {
      const rng = mulberry32(candidate);
      return Math.floor(rng() * 20) < Math.floor(rng() * 20);
    })!;
    const rng = mulberry32(seed);
    const first = Math.floor(rng() * 20) + 1;
    const second = Math.floor(rng() * 20) + 1;
    try {
      setRngSeed(seed);
      expect(await rollCombatSavingThrow(encounterId, targetId, 'str')).toBe(first);
      await claimRage(encounterId, targetId);
      setRngSeed(seed);
      expect(await rollCombatSavingThrow(encounterId, targetId, 'str')).toBe(second);
      setRngSeed(seed);
      expect(await rollCombatSavingThrow(encounterId, targetId, 'dex')).toBe(first);
    } finally {
      setRngSeed(undefined);
    }
  });

  it.each([
    ['burning-hands', 'Burning Hands', 1],
    ['dancing-lights', 'Dancing Lights', 0],
  ])(
    'refuses %s while raging without spending a spell slot or an action',
    async (id, name, level) => {
      await claimRage(encounterId, casterId);
      const slots = () =>
        db
          .select()
          .from(characterSpellSlots)
          .where(eq(characterSpellSlots.characterId, casterCharacterId));
      const before = await slots();
      await expect(castAtTarget(id, name, level)).rejects.toThrow(
        'You cannot cast spells or concentrate while raging.',
      );
      const [caster] = await db
        .select()
        .from(combatParticipants)
        .where(eq(combatParticipants.id, casterId));
      expect(caster.actionUsed).toBe(false);
      expect(await slots()).toEqual(before);
      expect(
        await maybeStartConcentrationFromSpellCast('[spell_id=dancing-lights]', sessionId),
      ).toBe(false);
      expect(
        await db
          .select()
          .from(characterConcentration)
          .where(eq(characterConcentration.characterId, casterCharacterId)),
      ).toEqual([]);
    },
  );
});
