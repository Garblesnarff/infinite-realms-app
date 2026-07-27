/* eslint-disable max-lines -- one fixture (campaign -> character -> session -> encounter ->
   board) rebuilt per test, because `concludeEncounter` destroys both the encounter and the
   board it ends. Splitting the file would mean standing up the same chain twice. */
/**
 * No encounter reaches a terminal state without an ending.
 *
 * Playtest run 18's encounter 2 was abandoned mid-fight. The monster stood at 2 of 11 hit
 * points, the row said `completed`, no `combat_ended` was ever logged, and the DM's next
 * context contained nothing to say a fight had happened — so a fresh encounter opened with no
 * narrative acknowledgement of the one before it. A player would have watched a fight stop.
 *
 * The mechanism was that four different code paths could write `status = 'completed'` and only
 * one of them — `endCombatIfResolved`, the victory/TPK check — did the whole job. The path the
 * DM actually reaches, `combat_transition: "end"` landing on `/tactical-map/end`, did the
 * least of all: it destroyed the board and flipped the row, with no reason, no telemetry, and
 * no sentence for the DM.
 *
 * `concludeEncounter` is now the only way an encounter ends, `endCombat` will not compile
 * without a reason, and the reason is written by the same statement that writes `completed`.
 * What is pinned here is the invariant rather than any one caller: after any ending, the row
 * carries a reason and the DM has a sentence waiting.
 *
 * Real database, not a mock. The failure lived in the seam between three services — one writes
 * a fact onto the tactical map row, another tears that row down, a third reads it back — and a
 * mocked `db` papers over exactly that seam.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import { closeRealDb, describeWithDb, hasRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  tacticalMaps,
} from '../../../../db/schema/index';

import type { CombatEndReason } from '../../types/combat.js';

const { concludeEncounter, describeCombatEnd } = await import('../combat/combat-ending.js');
const { consumeDmTacticalFacts, recordDmTacticalFact } =
  await import('../combat/tactical-action-service.js');
const { saveTacticalMap } = await import('../combat/tactical-map-store.js');

if (!hasRealDb) {
  console.warn(
    '[encounter-ending-reason] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

/**
 * Every reason the union admits. Enumerated from the type rather than hand-picked, so a new
 * ending added later without a sentence and without a caller fails here rather than in a
 * playtest six weeks on.
 */
const ALL_REASONS: CombatEndReason[] = [
  'last_hostile_defeated',
  'party_defeated',
  'dm_ended_scene',
  'ended_by_request',
  'abandoned',
];

describeWithDb('an encounter cannot reach a terminal state without a reason and a DM fact', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('ending-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  let monsterId: string;

  beforeEach(async () => {
    if (!hasRealDb) return;
    if (!campaignId) {
      [{ id: campaignId }] = await db
        .insert(campaigns)
        .values({ userId, name: testId('camp') })
        .returning({ id: campaigns.id });
      [{ id: characterId }] = await db
        .insert(characters)
        .values({ userId, campaignId, name: testId('hero'), level: 3, class: 'Fighter' })
        .returning({ id: characters.id });
      await db.insert(characterStats).values({
        characterId,
        strength: 16,
        armorClass: 15,
        maxHitPoints: 40,
        currentHitPoints: 40,
        speed: 30,
      });
      [{ id: sessionId }] = await db
        .insert(gameSessions)
        .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
        .returning({ id: gameSessions.id });
    }

    // A fresh encounter and board per test: `concludeEncounter` destroys both, and each
    // assertion is about what an ending leaves behind rather than about ending twice.
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
          name: 'Ending Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 40,
          speed: 30,
        },
        {
          encounterId,
          name: 'Ending Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 12,
          // Alive and standing, deliberately: the point of this suite is what happens to a
          // fight that is stopped rather than won. Run 18's monster was on 2 of 11.
          maxHp: 11,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    heroId = inserted.find((row) => row.turnOrder === 0)!.id;
    monsterId = inserted.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: heroId, currentHp: 40, maxHp: 40, isConscious: true },
      { participantId: monsterId, currentHp: 2, maxHp: 11, isConscious: true },
    ]);

    await saveTacticalMap({
      id: crypto.randomUUID(),
      sessionId,
      width: 8,
      height: 8,
      cells: Array.from({ length: 8 }, () =>
        Array.from({ length: 8 }, () => ({
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        })),
      ),
      entities: [
        {
          id: heroId,
          slug: 'ending-hero',
          x: 1,
          y: 1,
          size: 'medium',
          type: 'pc',
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: monsterId,
          slug: 'ending-golem',
          x: 3,
          y: 1,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'ending fixture',
    });
    // Any facts left by a previous test are drained, so a fact observed below was written by
    // the ending under test and not inherited from the one before it.
    await consumeDmTacticalFacts(sessionId);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const rows = await db
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .where(eq(combatEncounters.sessionId, sessionId));
    await db.delete(combatParticipantStatus).where(
      inArray(
        combatParticipantStatus.participantId,
        rows.map((row) => row.id),
      ),
    );
    await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
    for (const row of await db
      .select({ id: combatEncounters.id })
      .from(combatEncounters)
      .where(eq(combatEncounters.sessionId, sessionId))) {
      await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, row.id));
    }
    await db.delete(combatEncounters).where(eq(combatEncounters.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  const encounterRow = async () => {
    const [row] = await db
      .select({
        status: combatEncounters.status,
        endedReason: combatEncounters.endedReason,
        endedAt: combatEncounters.endedAt,
      })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return row;
  };

  test('every reason produces a distinct, non-empty sentence for the DM', () => {
    const sentences = ALL_REASONS.map(describeCombatEnd);
    expect(new Set(sentences).size).toBe(ALL_REASONS.length);
    for (const sentence of sentences) {
      expect(sentence).toContain('THE FIGHT IS OVER');
      // The failure this replaces is a new encounter opening in the same paragraph as the old
      // one stopping, with nothing said about the fight that just ended.
      expect(sentence.toLowerCase()).toContain('not start a new encounter in the same breath');
    }
  });

  test('a DM scene transition ends the fight with a reason and a narratable fact', async () => {
    // The exact run-18 path: `combat_transition: "end"` while a hostile is still standing.
    await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene');

    const row = await encounterRow();
    expect(row.status).toBe('completed');
    expect(row.endedReason).toBe('dm_ended_scene');
    expect(row.endedAt).not.toBeNull();

    // The fact survives the board teardown that happened inside the same call. That ordering
    // is the whole trick: `recordDmTacticalFact` writes onto the session's latest map row, and
    // the teardown is what stops that row being the active one.
    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toBe(describeCombatEnd('dm_ended_scene'));
    // It must not claim a victory: nobody was defeated, and the monster is still on 2 HP.
    expect(facts[0]).toContain('Nobody was defeated');
  });

  test('a victory ends the fight with its own reason and its own sentence', async () => {
    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');

    expect((await encounterRow()).endedReason).toBe('last_hostile_defeated');
    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts[0]).toContain('the party is victorious');
  });

  test('an abandonment says so, rather than being indistinguishable from a win', async () => {
    await concludeEncounter(encounterId, sessionId, userId, 'abandoned');

    expect((await encounterRow()).endedReason).toBe('abandoned');
    expect((await consumeDmTacticalFacts(sessionId))[0]).toContain('abandoned mid-fight');
  });

  test('a fact recorded just before the ending still reaches the DM alongside it', async () => {
    // The killing blow and the reason the fight ended arrive on the same turn, and for
    // seventeen runs the teardown between them threw the first one away.
    await recordDmTacticalFact(sessionId, 'Ending Hero struck the Ending Golem for 2 damage.');
    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');

    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toContain('struck the Ending Golem');
    expect(facts[1]).toContain('THE FIGHT IS OVER');
  });
});
