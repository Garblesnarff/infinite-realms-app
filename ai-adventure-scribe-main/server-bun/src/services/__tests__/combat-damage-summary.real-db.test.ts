/**
 * Combat damage summary aggregation from the damage log.
 *
 * Verifies that getCombatDamageSummary correctly aggregates per-participant
 * damage dealt/taken and total damage from combat_damage_log rows, and maps
 * vital states to summary statuses.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it } from 'bun:test';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  combatDamageLog,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';

if (!hasRealDb) {
  console.warn('[combat-damage-summary] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

describeWithDb('combat damage summary aggregation', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('user');

  let encounterId: string;
  let heroId: string;
  let goblinId: string;

  beforeAll(async () => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    const [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, name: testId('hero'), level: 3 })
      .returning({ id: characters.id });

    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 2, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const parts = await db
      .insert(combatParticipants)
      .values([
        { encounterId, name: 'Hero', participantType: 'player', characterId, turnOrder: 0, isActive: true },
        { encounterId, name: 'Goblin', participantType: 'monster', turnOrder: 1, isActive: true },
      ])
      .returning({ id: combatParticipants.id });
    [heroId, goblinId] = parts.map((p) => p.id);

    for (const pid of [heroId, goblinId]) {
      await db.insert(combatParticipantStatus).values({
        participantId: pid,
        maxHp: 20,
        currentHp: pid === goblinId ? 0 : 14,
        tempHp: 0,
        isConscious: pid !== goblinId,
      });
    }

    // Hero dealt 7 fire damage to the goblin (the N2-046 scenario: 7 damage kills).
    await db.insert(combatDamageLog).values({
      encounterId,
      participantId: goblinId,
      damageAmount: 7,
      damageType: 'fire',
      sourceParticipantId: heroId,
      sourceDescription: 'Fire Bolt',
      roundNumber: 1,
    });
    // Goblin dealt 6 damage back to the hero.
    await db.insert(combatDamageLog).values({
      encounterId,
      participantId: heroId,
      damageAmount: 6,
      damageType: 'slashing',
      sourceParticipantId: goblinId,
      sourceDescription: 'Scimitar',
      roundNumber: 1,
    });
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('returns non-zero damage totals from the damage log', async () => {
    const { getCombatDamageSummary } = await import('../combat/combat-damage-summary.js');
    const summary = await getCombatDamageSummary(encounterId, userId);
    expect(summary.encounterId).toBe(encounterId);
    expect(summary.rounds).toBe(2);
    // Total damage dealt across all participants: 7 + 6 = 13.
    expect(summary.totalDamage).toBe(13);
    const hero = summary.participants.find((p) => p.participantId === heroId);
    const goblin = summary.participants.find((p) => p.participantId === goblinId);
    expect(hero?.damageDealt).toBe(7);
    expect(hero?.damageTaken).toBe(6);
    expect(goblin?.damageDealt).toBe(6);
    expect(goblin?.damageTaken).toBe(7);
  });

  it('marks the dead goblin as dead, hero as ok', async () => {
    const { getCombatDamageSummary } = await import('../combat/combat-damage-summary.js');
    const summary = await getCombatDamageSummary(encounterId, userId);
    const goblin = summary.participants.find((p) => p.participantId === goblinId);
    const hero = summary.participants.find((p) => p.participantId === heroId);
    expect(goblin?.status).toBe('dead');
    expect(hero?.status).toBe('ok');
  });
});
