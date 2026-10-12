/**
 * #310: XP must not be awarded for a fight that never had enemies.
 *
 * Hark's NT rows (2026-10-12): picking [Strike] on a combat-entry card put +25/+50/+75 XP
 * on the sheet the moment combat started — before any attack, with no chat message. Those
 * amounts are exactly the level-1 victory thresholds from combat-xp-mechanics.ts, which
 * means `awardCombatVictoryXp` ran. It is gated on `reason === 'last_hostile_defeated'`,
 * and `endCombatIfResolved` returns that reason whenever no hostiles are standing —
 * including when no hostiles were ever seated.
 *
 * The invariant: victory XP requires defeated enemies. An encounter with no hostile
 * participants is not a victory.
 *
 * Real database, not a mock — the award path runs through CombatEncounterService and
 * drizzle transactions.
 */
import { afterAll, beforeEach, expect, test } from 'bun:test';
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
  characters,
  characterStats,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
} from '../../../../db/schema/index';

const { awardCombatVictoryXp } = await importWithRealDb(
  () => import('../combat/combat-xp.js'),
);
const { executeCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);

if (!hasRealDb) {
  console.warn('[310-no-hostile-xp] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres.');
}

describeWithDb('#310: no victory XP without hostiles', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('310-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;

  beforeEach(async () => {
    if (!hasRealDb) return;
    if (!campaignId) {
      [{ id: campaignId }] = await db
        .insert(campaigns)
        .values({ userId, name: testId('310-camp') })
        .returning({ id: campaigns.id });
      [{ id: characterId }] = await db
        .insert(characters)
        .values({ userId, campaignId, name: testId('310-hero'), level: 1, class: 'Fighter' })
        .returning({ id: characters.id });
      await db.insert(characterStats).values({
        characterId,
        strength: 16,
        armorClass: 15,
        maxHitPoints: 14,
        currentHitPoints: 14,
        speed: 30,
      });
    }
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
  });

  afterAll(async () => {
    await closeRealDb();
  });

  async function makeEncounter(withMonster: boolean, monsterHp: number = 0) {
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
        difficulty: 'medium',
      })
      .returning({ id: combatEncounters.id });
    const parts: any[] = [
      {
        encounterId,
        characterId,
        name: 'XP Hero',
        participantType: 'player',
        turnOrder: 0,
        initiative: 20,
        armorClass: 15,
        maxHp: 14,
        speed: 30,
        isActive: true,
      },
    ];
    if (withMonster) {
      parts.push({
        encounterId,
        name: 'XP Goblin',
        participantType: 'monster',
        turnOrder: 1,
        initiative: 10,
        armorClass: 12,
        maxHp: 11,
        speed: 30,
        isActive: true,
      });
    }
    const inserted = await db
      .insert(combatParticipants)
      .values(parts)
      .returning({ id: combatParticipants.id, participantType: combatParticipants.participantType });
    const heroId = inserted.find((r) => r.participantType === 'player')!.id;
    await db.insert(combatParticipantStatus).values({
      participantId: heroId,
      currentHp: 14,
      maxHp: 14,
      isConscious: true,
    });
    if (withMonster) {
      const monsterId = inserted.find((r) => r.participantType === 'monster')!.id;
      await db.insert(combatParticipantStatus).values({
        participantId: monsterId,
        currentHp: monsterHp,
        maxHp: 11,
        isConscious: monsterHp > 0,
      });
    }
    return encounterId;
  }

  async function heroXp() {
    const [row] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    return row?.xp ?? 0;
  }

  test('an encounter with no hostiles awards no victory XP', async () => {
    if (!hasRealDb) return;
    const encounterId = await makeEncounter(false);
    const before = await heroXp();
    const { awarded } = await awardCombatVictoryXp({ encounterId, sessionId, userId });
    expect(awarded).toEqual([]);
    expect(await heroXp()).toBe(before);
  });

  test('a legitimately won fight still awards XP', async () => {
    if (!hasRealDb) return;
    // Monster seated at 0 HP = defeated.
    const encounterId = await makeEncounter(true, 0);
    const before = await heroXp();
    const { awarded } = await awardCombatVictoryXp({ encounterId, sessionId, userId });
    expect(awarded.length).toBe(1);
    expect(awarded[0].xp).toBeGreaterThan(0);
    expect(await heroXp()).toBeGreaterThan(before);
  });

  test('end_turn on a player-only encounter: stays active, no last_hostile_defeated, XP unchanged', async () => {
    // Reproduces the #310 client path: end_turn triggers endCombatIfResolved, which
    // (before the guard) read "no hostiles standing" on a monster-less encounter and
    // concluded it as last_hostile_defeated, awarding victory XP with no message.
    if (!hasRealDb) return;
    const encounterId = await makeEncounter(false);
    const [hero] = await db
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, encounterId));
    const before = await heroXp();

    const result = (await executeCombatIntent(
      encounterId,
      { type: 'end_turn', actorId: hero.id },
      userId,
      'player',
    )) as { combatEnded?: boolean; endedReason?: string };

    // The #310 guard: endCombatIfResolved returns null, so the encounter does not end
    // and no victory reason is recorded.
    expect(result.combatEnded).not.toBe(true);
    expect(result.endedReason).not.toBe('last_hostile_defeated');
    const [encounter] = await db
      .select({ status: combatEncounters.status, endedReason: combatEncounters.endedReason })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(encounter.status).toBe('active');
    expect(encounter.endedReason).toBeNull();
    expect(await heroXp()).toBe(before);
  });
});
