/**
 * Playtest run 16 regression: nine encounters in one three-minute session.
 *
 * What was happening, mechanically. `endCombatIfResolved` runs after every damaging action
 * and asks "are both sides still standing?" as `livingTypes.has('player') &&
 * livingTypes.has('npc')`. But `combat_participants.participant_type` carries four values,
 * and `startCombat` stamps a DM-authored combatant `'monster'` (with an SRD id) or `'other'`
 * (without one) — `'npc'` only ever comes from an `npcId`, a database NPC row that
 * structured combat starts never supply. So no structured encounter has ever contained a
 * living `'npc'`, the test was false from the first landed hit onward, and every damaging
 * action ended the fight and tore down the tactical map with the enemy still up. Run 16's
 * monster finished at 2/11 HP in an encounter the engine had already closed. The DM, reading
 * a session that was correctly no longer in combat, started a new one; the next hit ended
 * that one too; nine times over.
 *
 * These tests pin both halves: an encounter with a living hostile survives a landed hit, and
 * a session already in combat does not get a second encounter.
 *
 * Real database, not a mock: the bug is in a query result's *values*, and a mocked `db`
 * returns whatever the test author expected those values to be.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  characterStats,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../db/schema/index';

const { executeCombatIntent } = await import('../combat/combat-intent-service.js');
const { CombatEncounterService } = await import('../combat/combat-encounter-service.js');

if (!hasRealDb) {
  console.warn(
    '[encounter-lifecycle] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('an encounter survives a landed hit while a hostile is still standing', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('lifecycle-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let monsterId: string;

  const MONSTER_HP = 200;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: 5, class: 'Fighter' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 20,
      armorClass: 15,
      maxHitPoints: 50,
      currentHitPoints: 50,
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
          name: 'Lifecycle Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 50,
          speed: 30,
        },
        {
          encounterId,
          name: 'Lifecycle Golem',
          // The value the old check could not see. Everything below turns on this string.
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          // AC 1: the hit must land, because the bug only fires on a damaging action.
          armorClass: 1,
          maxHp: MONSTER_HP,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    monsterId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 50, maxHp: 50, isConscious: true },
      {
        participantId: monsterId,
        currentHp: MONSTER_HP,
        maxHp: MONSTER_HP,
        isConscious: true,
      },
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

  const statusOf = async (participantId: string): Promise<number> => {
    const [row] = await db
      .select({ hp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    return row.hp;
  };

  const encounterStatus = async (): Promise<string> => {
    const [row] = await db
      .select({ status: combatEncounters.status })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row.status;
  };

  const heroAttacks = async () => {
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    await db
      .update(combatEncounters)
      .set({ currentTurnOrder: 0, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId));
    return executeCombatIntent(
      encounterId,
      { type: 'attack', actorId: heroId, targetId: monsterId },
      userId,
      'dm',
    );
  };

  /**
   * Attacks until damage actually lands.
   *
   * The monster's AC is 1, so the only way to miss is a natural 1 — but a natural 1 always
   * misses regardless of AC, which makes a single attack a 5% coin flip. Every assertion in
   * this suite is about what happens *after* damage is applied, so a missed attack tests
   * nothing and fails for a reason unrelated to the behaviour under test.
   *
   * This was latent from the moment the suite was written and surfaced when an unrelated new
   * suite shifted the shared `Math.random` stream. Bounded at twelve: the odds of twelve
   * consecutive natural 1s are 1 in 20^12.
   */
  const heroAttacksUntilDamage = async (): Promise<void> => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const before = await statusOf(monsterId);
      await heroAttacks();
      if ((await statusOf(monsterId)) < before) return;
    }
    throw new Error('twelve consecutive misses against AC 1 — the dice are not the problem');
  };

  test('a landed hit on a living monster does not end the encounter', async () => {
    expect(await encounterStatus()).toBe('active');

    await heroAttacksUntilDamage();

    const hpAfter = await statusOf(monsterId);
    // Precondition for the assertion that follows: damage really did land, so the
    // end-of-combat check really did run. Without this a passing test could mean nothing
    // more than "the attack missed".
    expect(hpAfter).toBeLessThan(MONSTER_HP);
    expect(hpAfter).toBeGreaterThan(0);

    // The regression itself. Before the fix this read 'completed' with the monster on
    // ~190 HP, the tactical map was destroyed, and the DM restarted combat next turn.
    expect(await encounterStatus()).toBe('active');
  });

  test('the encounter is still the active one for the session, so no second one is created', async () => {
    // The server's combat-start endpoint is idempotent *against an active encounter*
    // (initiative.ts returns `alreadyActive` rather than inserting). That guard was never
    // the problem: it was never reached, because by the time the DM asked again there was
    // genuinely no active encounter to find. This asserts the guard's precondition holds.
    const active = await CombatEncounterService.getActiveEncounter(sessionId, userId);
    expect(active?.id).toBe(encounterId);
  });

  test('combat still ends when the last hostile actually goes down', async () => {
    // The fix must not make encounters immortal. Drop the monster and confirm the same
    // check closes the fight.
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 1 })
      .where(eq(combatParticipantStatus.participantId, monsterId));

    await heroAttacksUntilDamage();

    expect(await statusOf(monsterId)).toBe(0);
    expect(await encounterStatus()).toBe('completed');
    expect(await CombatEncounterService.getActiveEncounter(sessionId, userId)).toBeUndefined();
  });
});
