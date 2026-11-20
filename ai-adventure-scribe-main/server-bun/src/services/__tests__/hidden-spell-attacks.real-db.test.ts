/**
 * The hidden mark on spells, and the plain-words out-of-reach refusal (#1651), against a real Postgres.
 *
 * - A hidden caster's spell attack gets advantage with source "hidden", and the cast clears the mark,
 *   hit or miss (2014 SRD 5.1: a hidden attacker gives away its position when the attack hits or misses).
 * - A save-only spell clears the mark and gets no advantage.
 * - A melee attack from beyond reach is refused in words that say who, how far, and what to do.
 *
 * The production `resolveSpellAttack`, `proposeSpellAttack`, and `resolveAttack` run against the
 * database. The hit and miss cases pin both advantage dice so critical rolls cannot flip the result.
 * No suite here calls the live DM. Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
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
  characterSpellSlots,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
  tacticalMaps,
} from '../../../../db/schema/index';

const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { isHiddenAttacker, markHiddenAttacker } = await importWithRealDb(
  () => import('../combat/combat-turn-flags.js'),
);
const { saveTacticalMap } = await importWithRealDb(
  () => import('../combat/tactical-map-store.js'),
);

if (!hasRealDb) {
  console.warn('[hidden-spell-attacks] SKIPPED: set TEST_DATABASE_URL to run these.');
}

/** AC 1 is hit except on a natural 1; a high AC makes the same attack a miss on any roll but a natural 20. */
const UNMISSABLE_AC = 1;
const UNREACHABLE_AC = 30;

describeWithDb('Hidden attackers and spell attacks (#1651)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('hidden-spell-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let warlockId: string;
  let golemId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('hidden-spell-camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('hidden-warlock'),
        level: 3,
        class: 'Warlock',
        knownSpells: 'Eldritch Blast, Sacred Flame',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      dexterity: 12,
      charisma: 16,
      armorClass: 12,
      maxHitPoints: 30,
      currentHitPoints: 30,
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
          name: 'The Hidden Warlock',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          name: 'Watching Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: UNMISSABLE_AC,
          maxHp: 500,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    warlockId = inserted.find((row) => row.turnOrder === 0)!.id;
    golemId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: warlockId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: golemId, currentHp: 500, maxHp: 500, isConscious: true },
    ]);

    await saveBoard(2);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .update(gameSessions)
      .set({ sessionState: {} })
      .where(eq(gameSessions.id, sessionId));
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 30, isConscious: true })
      .where(eq(combatParticipantStatus.participantId, warlockId));
    await db
      .update(combatParticipants)
      .set({ armorClass: UNMISSABLE_AC })
      .where(eq(combatParticipants.id, golemId));
    await saveBoard(2);
  });

  /**
   * A 12 x 3 floor. The warlock stands at x 0; the golem at `golemXPosition`, 5 feet per cell. The
   * default is 10 feet: a ranged attack within 5 feet of a hostile has disadvantage (combat-rules), which
   * would cancel the hidden advantage this suite measures.
   */
  const saveBoard = async (golemXPosition: number): Promise<void> => {
    const width = 12;
    const height = 3;
    const cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as 0 | 1 | 2 | 3,
        elevation: 0,
      })),
    );
    await saveTacticalMap!({
      id: crypto.randomUUID(),
      sessionId,
      width,
      height,
      cells,
      entities: [
        {
          id: warlockId,
          slug: 'hidden-warlock',
          x: 0,
          y: 1,
          size: 'medium' as const,
          type: 'pc' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: golemId,
          slug: 'watching-golem',
          x: golemXPosition,
          y: 1,
          size: 'medium' as const,
          type: 'monster' as const,
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'hidden attacker fixture',
    });
  };

  /** Hands the turn to the warlock, refunds actions, and returns the version to claim. */
  const giveTurnToWarlock = async (): Promise<number> => {
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

  const isHidden = (): Promise<boolean> => isHiddenAttacker(encounterId, warlockId);

  it('a hidden caster’s eldritch blast is proposed with advantage from "hidden", and the proposal keeps the mark', async () => {
    await markHiddenAttacker(encounterId, warlockId);

    const proposal = await combatAttackService!.proposeSpellAttack(
      encounterId,
      { casterId: warlockId, targetIds: [golemId], spellId: 'eldritch-blast', spellName: 'Eldritch Blast' },
      userId,
    );

    expect(proposal.advantage).toBe(true);
    expect(proposal.advantageSources).toContain('hidden');
    expect(await isHidden()).toBe(true);
  });

  it('a hidden caster’s spell attack that hits clears the mark', async () => {
    await markHiddenAttacker(encounterId, warlockId);

    const resolution = await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: warlockId,
        targetIds: [golemId],
        spellId: 'eldritch-blast',
        spellName: 'Eldritch Blast',
        d20: 10,
        d20Rolls: [10, 7],
        expectedVersion: await giveTurnToWarlock(),
      },
      userId,
    );

    expect(resolution.results[0].hit).toBe(true);
    expect(await isHidden()).toBe(false);
  });

  it('a hidden caster’s spell attack that misses clears the mark too', async () => {
    await db
      .update(combatParticipants)
      .set({ armorClass: UNREACHABLE_AC })
      .where(eq(combatParticipants.id, golemId));
    await markHiddenAttacker(encounterId, warlockId);

    const resolution = await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: warlockId,
        targetIds: [golemId],
        spellId: 'eldritch-blast',
        spellName: 'Eldritch Blast',
        d20: 10,
        d20Rolls: [10, 7],
        expectedVersion: await giveTurnToWarlock(),
      },
      userId,
    );

    expect(resolution.results[0].hit).toBe(false);
    expect(await isHidden()).toBe(false);
  });

  it('a hidden caster’s save-only spell clears the mark and gets no advantage', async () => {
    await giveTurnToWarlock();
    await markHiddenAttacker(encounterId, warlockId);

    const proposal = await combatAttackService!.proposeSpellAttack(
      encounterId,
      { casterId: warlockId, targetIds: [golemId], spellId: 'sacred-flame', spellName: 'Sacred Flame' },
      userId,
    );
    expect(proposal.advantageSources).not.toContain('hidden');
    expect(proposal.advantage).toBe(false);

    await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: warlockId,
        targetIds: [golemId],
        spellId: 'sacred-flame',
        spellName: 'Sacred Flame',
        expectedVersion: await giveTurnToWarlock(),
      },
      userId,
    );

    expect(await isHidden()).toBe(false);
  });

  it('a melee attack from beyond reach is refused in plain words: who, how far, and the reach', async () => {
    await saveBoard(10);

    await expect(
      combatAttackService!.resolveAttack(
        encounterId,
        {
          attackerId: warlockId,
          targetId: golemId,
          expectedVersion: await giveTurnToWarlock(),
          attackType: 'melee',
        },
        userId,
      ),
    ).rejects.toThrow(/Watching Golem is 50 feet away, out of your 5-foot reach — move closer and attack again/);
  });
});
