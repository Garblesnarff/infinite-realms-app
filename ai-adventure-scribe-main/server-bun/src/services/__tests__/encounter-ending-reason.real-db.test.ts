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
import { and, desc, eq, inArray } from 'drizzle-orm';

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
  dialogueHistory,
  experienceEvents,
  gameSessions,
  tacticalMaps,
} from '../../../../db/schema/index';

import type { CombatEndReason } from '../../types/combat.js';
import type { EngineChatLineWriter } from '../engine-chat-line.js';

const { concludeEncounter, describeCombatEnd } = await importWithRealDb(
  () => import('../combat/combat-ending.js'),
);
const { awardCombatVictoryXp } = await importWithRealDb(
  () => import('../combat/combat-xp.js'),
);
const { consumeDmTacticalFacts, recordDmTacticalFact } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { saveTacticalMap } = await importWithRealDb(() => import('../combat/tactical-map-store.js'));
const { awardStoryXp, awardStoryXpOnce } = await importWithRealDb(() => import('../dm/story-xp.js'));
const { executeCombatIntent } = await importWithRealDb(
  () => import('../combat/combat-intent-service.js'),
);

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
  'ended_idle',
];

describeWithDb('an encounter cannot reach a terminal state without a reason and a DM fact', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('ending-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  const createdSessionIds: string[] = [];
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
    }

    // A fresh SESSION per test, not just a fresh encounter. Since #1954 a partial unique
    // index allows one active encounter per session, and not every test here concludes the
    // encounter it was given -- the pure `every reason produces a distinct sentence` case
    // never touches the database at all -- so a per-test encounter on one shared session
    // collides with the row the previous test left active. Isolating the session is what
    // the invariant asks for; the campaign and character stay shared because nothing here
    // asserts on them.
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);

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
      .where(inArray(combatEncounters.sessionId, createdSessionIds));
    await db.delete(combatParticipantStatus).where(
      inArray(
        combatParticipantStatus.participantId,
        rows.map((row) => row.id),
      ),
    );
    await db.delete(tacticalMaps).where(inArray(tacticalMaps.sessionId, createdSessionIds));
    for (const row of await db
      .select({ id: combatEncounters.id })
      .from(combatEncounters)
      .where(inArray(combatEncounters.sessionId, createdSessionIds))) {
      await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, row.id));
    }
    await db.delete(combatEncounters).where(inArray(combatEncounters.sessionId, createdSessionIds));
    await db.delete(gameSessions).where(inArray(gameSessions.id, createdSessionIds));
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

  /** Persisted chat-visible engine lines for a session, filtered by marker. */
  const engineNotices = async (sid: string, marker: string) => {
    const rows = await db
      .select({ message: dialogueHistory.message })
      .from(dialogueHistory)
      .where(and(eq(dialogueHistory.sessionId, sid), eq(dialogueHistory.speakerType, 'system')));
    return rows.map((row) => row.message).filter((message) => message.includes(marker));
  };
  const victoryNotices = (sid: string) => engineNotices(sid, '⚙️ Engine: Victory!');
  const storyNotices = (sid: string) => engineNotices(sid, '⚙️ Engine: Story XP');

  /** The latest player message's server clock for a session (the award's `since`). */
  const playerSince = async (sid: string) => {
    const [row] = await db
      .select({ createdAt: dialogueHistory.createdAt })
      .from(dialogueHistory)
      .where(and(eq(dialogueHistory.sessionId, sid), eq(dialogueHistory.speakerType, 'player')))
      .orderBy(desc(dialogueHistory.createdAt))
      .limit(1);
    if (!row?.createdAt) throw new Error('[encounter-ending-reason] the player row has no created_at');
    return row.createdAt;
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

  test('a DM scene transition is refused while a hostile still stands (#2524)', async () => {
    // Run D1's shape: `combat_transition: "end"` while the monster is conscious at 2/11.
    // The engine owns death, so the scene cannot end and the DM is told why.
    const concluded = await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene');

    expect(concluded).toBe(false);
    const row = await encounterRow();
    expect(row.status).toBe('active');
    expect(row.endedReason).toBeNull();

    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toContain('COMBAT HAS NOT ENDED');
    expect(facts[0]).toContain('Ending Golem');
  });

  test('a fled exit addressed by board slug marks goblin-2 inactive, not dead (#2524)', async () => {
    // The DM declares exits by the slug the board shows, never the database id.
    const concluded = await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene', {
      exits: [{ participant_id: 'ending-golem', exit: 'fled' }],
    });
    expect(concluded).toBe(true);
    const [monster] = await db
      .select({ isActive: combatParticipants.isActive })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, monsterId));
    expect(monster.isActive).toBe(false);
    const [status] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, monsterId));
    expect(status.currentHp).toBe(2);
  });

  test('a declared fled exit ends the scene and marks the hostile fled, never dead (#2524)', async () => {
    const concluded = await concludeEncounter(encounterId, sessionId, userId, 'dm_ended_scene', {
      exits: [{ participant_id: monsterId, exit: 'fled' }],
    });

    expect(concluded).toBe(true);
    const row = await encounterRow();
    expect(row.status).toBe('completed');
    expect(row.endedReason).toBe('dm_ended_scene');

    const [monster] = await db
      .select({ isActive: combatParticipants.isActive })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, monsterId));
    expect(monster.isActive).toBe(false);
    const [status] = await db
      .select({ currentHp: combatParticipantStatus.currentHp })
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, monsterId));
    // Still on the 2 HP the engine last wrote: an exit is not a kill.
    expect(status.currentHp).toBe(2);

    const facts = await consumeDmTacticalFacts(sessionId);
    expect(facts.some((fact) => fact.includes('has fled the fight'))).toBe(true);
    expect(facts.some((fact) => fact.includes('NOT dead'))).toBe(true);
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
    expect(facts).toHaveLength(3);
    expect(facts[0]).toContain('struck the Ending Golem');
    expect(facts[1]).toContain('THE FIGHT IS OVER');
    // #310: the victory also carries its XP award, so the gain is not silent.
    expect(facts[2]).toContain('COMBAT XP');
  });

  test('concluding an encounter twice is one terminal transition and one DM fact', async () => {
    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');
    const first = await encounterRow();

    // This is the post-victory trailing intent from encounter 10444307. The second call must
    // stop at the active -> completed claim before it can write another tactical fact or move
    // the terminal timestamp.
    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');
    const second = await encounterRow();

    expect(second.status).toBe('completed');
    expect(second.endedReason).toBe('last_hostile_defeated');
    expect(second.endedAt?.getTime()).toBe(first.endedAt?.getTime());
    await recordDmTacticalFact(sessionId, 'late post-conclusion fact');
    expect(await consumeDmTacticalFacts(sessionId)).toEqual([
      describeCombatEnd('last_hostile_defeated'),
      // #310: the victory's XP award fact, recorded once with the ending.
      expect.stringContaining('COMBAT XP'),
    ]);
  });

  test('#2517: a won fight leaves the session active', async () => {
    const sessionRow = async (): Promise<{ status: string | null; endTime: Date | null }> => {
      const [row] = await db
        .select({ status: gameSessions.status, endTime: gameSessions.endTime })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId));
      return row;
    };

    expect((await sessionRow()).status).toBe('active');

    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');
    // A won fight leaves the session open for the next scene.
    expect((await sessionRow()).status).toBe('active');
  });

  test('#2517: a party defeat completes the session when the hero is dead', async () => {
    // The single truth, written by the vitals mirror during the killing
    // resolution: the hero is dead, not merely down.
    await db
      .update(characterStats)
      .set({ vitalState: 'dead', currentHitPoints: 0 })
      .where(eq(characterStats.characterId, characterId));

    const [row] = await db
      .select({ status: gameSessions.status, endTime: gameSessions.endTime })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    expect(row.status).toBe('active');
    expect(row.endTime).toBeNull();

    await concludeEncounter(encounterId, sessionId, userId, 'party_defeated');

    const [after] = await db
      .select({ status: gameSessions.status, endTime: gameSessions.endTime })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    // Completed, so the chronicle can be written for a dead run; the
    // encounter claim and this write commit together.
    expect(after.status).toBe('completed');
    expect(after.endTime).not.toBeNull();
  });

  test('#2517: a party defeat leaves the session active while the hero is only stabilised', async () => {
    // `party_defeated` also concludes a fight nobody can advance (a
    // stabilised hero cannot be roused by the engine), but a stabilised
    // hero is not dead: the run continues in this session and neither the
    // completion nor the end state may fire.
    await db
      .update(characterStats)
      .set({ vitalState: 'stabilized', currentHitPoints: 0 })
      .where(eq(characterStats.characterId, characterId));

    await concludeEncounter(encounterId, sessionId, userId, 'party_defeated');

    const [after] = await db
      .select({ status: gameSessions.status, endTime: gameSessions.endTime })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    expect(after.status).toBe('active');
    expect(after.endTime).toBeNull();
  });

  test('a victory awards combat XP to the sheet and states it for the DM (#310)', async () => {
    // The fixture hero is shared across tests in this file and other victory tests award
    // XP to it, so assert on the delta from this conclusion, not the absolute sheet value.
    const [sheetBefore] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    const eventsBefore = await db
      .select()
      .from(experienceEvents)
      .where(eq(experienceEvents.characterId, characterId));
    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');

    // The fixture hero is level 3 and the encounter carries no difficulty: medium band, 150 XP.
    const [sheet] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect((sheet.xp ?? 0) - (sheetBefore.xp ?? 0)).toBe(150);
    const events = await db
      .select()
      .from(experienceEvents)
      .where(eq(experienceEvents.characterId, characterId));
    // Filter by source instead of taking the last row: the combat award is the event that
    // was absent before this conclusion and carries the combat source.
    const newCombatEvents = events.filter(
      (event) => event.source === 'combat' && !eventsBefore.some((before) => before.id === event.id),
    );
    expect(newCombatEvents).toHaveLength(1);
    expect(newCombatEvents[0].xpGained).toBe(150);
    const [encounter] = await db
      .select({ awarded: combatEncounters.experienceAwarded })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(encounter.awarded).toBe(150);
    const facts = await consumeDmTacticalFacts(sessionId);
    const xpFact = facts.find((fact) => fact.includes('COMBAT XP'));
    expect(xpFact).toContain('+150 XP');
    // The award is already on the sheet: the DM must not set xp_award for this victory too.
    expect(xpFact).toContain('Do not set xp_award for this victory');

    // A retry after the conclusion cannot double-award: the claim boundary plus the
    // experience_awarded write inside one transaction make the second call a no-op.
    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');
    const [sheetAgain] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(sheetAgain.xp).toBe(sheet.xp);
  });

  test('combat start grants no XP and posts no victory notice: the end check does not fire on a live fight (#310)', async () => {
    // Hark N2 (2026-10-13): XP landed on the sheet (+25/50/75) the moment combat started,
    // before any attack, with no message. The victory award is the only in-combat XP
    // writer, so the invariant is pinned at its choke point: the end check, run through
    // the real intent pipeline the same way the entry route's NPC drain runs it at combat
    // start, must not conclude a fight whose monster is still standing.
    const [sheetBefore] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    const eventsBefore = await db
      .select({ id: experienceEvents.id })
      .from(experienceEvents)
      .where(eq(experienceEvents.characterId, characterId));

    // The combat-entry route drains NPC turns right after seating, and every drained turn
    // ends with an end_turn through this pipeline, which runs the end check. The hero
    // holds the turn here (initiative 20 over the golem's 10), so this is the player's
    // own end_turn on a live fight. The golem is standing at 2/11 HP with no seated XP,
    // so a misfire would pay the level-3 medium threshold band: 150.
    await executeCombatIntent(
      encounterId,
      { type: 'end_turn', actorId: heroId },
      userId,
      'player',
    );

    // The fight is untouched: still active, no award, no notice.
    const row = await encounterRow();
    expect(row.status).toBe('active');
    expect(row.endedReason).toBeNull();
    const [sheetAfter] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect(sheetAfter.xp ?? 0).toBe(sheetBefore.xp ?? 0);
    const eventsAfter = await db
      .select({ id: experienceEvents.id })
      .from(experienceEvents)
      .where(eq(experienceEvents.characterId, characterId));
    expect(eventsAfter).toHaveLength(eventsBefore.length);
    expect(await victoryNotices(sessionId)).toHaveLength(0);
  });

  test('a failed victory notice write is recovered on retry without re-awarding (#310)', async () => {
    const [sheetBefore] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    // Fail-first: the award commits, the notice write throws (caught and logged by the
    // ensure — the award flow never breaks on a lost notice).
    const failingWriter: EngineChatLineWriter = async () => {
      throw new Error('transient notice failure');
    };
    const first = await awardCombatVictoryXp(
      { encounterId, sessionId, userId },
      { noticeWriter: failingWriter },
    );
    expect(first.awarded).toHaveLength(1);
    expect(await victoryNotices(sessionId)).toHaveLength(0);

    // Retry: the award is not repeated, the notice is re-posted from the stored award.
    const second = await awardCombatVictoryXp({ encounterId, sessionId, userId });
    expect(second.awarded).toHaveLength(0);
    const [sheet] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    // The fixture hero is level 3 and the golem seats no XP: medium threshold band, 150.
    expect((sheet.xp ?? 0) - (sheetBefore.xp ?? 0)).toBe(150);
    const combatEvents = await db
      .select({ id: experienceEvents.id })
      .from(experienceEvents)
      .where(
        and(
          eq(experienceEvents.characterId, characterId),
          eq(experienceEvents.sessionId, sessionId),
          eq(experienceEvents.source, 'combat'),
        ),
      );
    expect(combatEvents).toHaveLength(1);
    const notices = await victoryNotices(sessionId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('⚙️ Engine: Victory!');
    expect(notices[0]).toContain('+150 XP');
    expect(notices[0]).toContain('Already on your character sheets.');
  });

  test('a failed story-XP notice write is recovered on retry without re-awarding (#310)', async () => {
    // GP-074: a story win out of combat — the logbook solved. The player message is what
    // the award keys its once-per-message idempotency on.
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: 'I piece together the logbook.',
    });
    const [sheetBefore] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));

    // Fail-first: the grant commits, the notice write throws (caught and logged).
    const failingWriter: EngineChatLineWriter = async () => {
      throw new Error('transient notice failure');
    };
    const outcome = await awardStoryXp(
      { userId, sessionId, xpAward: { amount: 50, reason: 'Solved the logbook' } },
      { noticeWriter: failingWriter },
    );
    expect(outcome).toBe('awarded');
    expect(await storyNotices(sessionId)).toHaveLength(0);

    // Retry (the DM re-sends the turn): already_awarded, and the notice is re-posted
    // from the STORED event — the retry's different amount/reason must not leak in,
    // and the award must not be written again.
    const retryOutcome = await awardStoryXp({
      userId,
      sessionId,
      xpAward: { amount: 60, reason: 'Solved the logbook again' },
    });
    expect(retryOutcome).toBe('already_awarded');
    const [sheet] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    expect((sheet.xp ?? 0) - (sheetBefore.xp ?? 0)).toBe(50);
    const notices = await storyNotices(sessionId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('⚙️ Engine: Story XP');
    expect(notices[0]).toContain('+50 XP');
    expect(notices[0]).toContain('Solved the logbook');
    expect(notices[0]).not.toContain('+60 XP');
  });

  test('a capped story-XP retry messages the stored granted amount, not the request (#310, #273)', async () => {
    // Level 3 story cap is 450/session. Fill most of it, then fail the notice on a
    // partial-cap grant; the retry must message the 50 granted, not the 100 requested.
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: 'I rally the villagers.',
    });
    const firstGrant = await awardStoryXpOnce({
      characterId,
      sessionId,
      since: await playerSince(sessionId),
      amount: 400,
      reason: 'Rallied the villagers',
    });
    expect(firstGrant.outcome).toBe('awarded');
    expect(firstGrant.granted).toBe(400);

    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: 'I broker the truce.',
    });
    const failingWriter: EngineChatLineWriter = async () => {
      throw new Error('transient notice failure');
    };
    const cappedOutcome = await awardStoryXp(
      { userId, sessionId, xpAward: { amount: 100, reason: 'Brokered the truce' } },
      { noticeWriter: failingWriter },
    );
    expect(cappedOutcome).toBe('capped');
    expect(await storyNotices(sessionId)).toHaveLength(0);

    const retryOutcome = await awardStoryXp({
      userId,
      sessionId,
      xpAward: { amount: 100, reason: 'Brokered the truce' },
    });
    expect(retryOutcome).toBe('already_awarded');
    const notices = await storyNotices(sessionId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('+50 XP');
    expect(notices[0]).not.toContain('+100 XP');
  });

  test('a victory awards combat XP at level 20 while story XP stays capped at 0 (#310, #273)', async () => {
    // The fixture hero is level 3 and shared across tests, so the level-20 check gets its
    // own character, session and encounter (one active encounter per session since #1954).
    const [{ id: epicId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('epic'), level: 20, class: 'Fighter' })
      .returning({ id: characters.id });
    const [{ id: epicSessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId: epicId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(epicSessionId);
    const [{ id: epicEncounterId }] = await db
      .insert(combatEncounters)
      .values({
        sessionId: epicSessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning({ id: combatEncounters.id });
    const epicParts = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId: epicEncounterId,
          characterId: epicId,
          name: 'Epic Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 200,
          speed: 30,
        },
        {
          encounterId: epicEncounterId,
          name: 'Epic Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 12,
          maxHp: 11,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    const epicHeroId = epicParts.find((row) => row.turnOrder === 0)!.id;
    const epicMonsterId = epicParts.find((row) => row.turnOrder === 1)!.id;
    await db.insert(combatParticipantStatus).values([
      { participantId: epicHeroId, currentHp: 200, maxHp: 200, isConscious: true },
      { participantId: epicMonsterId, currentHp: 2, maxHp: 11, isConscious: true },
    ]);
    await saveTacticalMap({
      id: crypto.randomUUID(),
      sessionId: epicSessionId,
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
          id: epicHeroId,
          slug: 'epic-hero',
          x: 1,
          y: 1,
          size: 'medium',
          type: 'pc',
          speedFeet: 30,
          movementRemaining: 30,
        },
        {
          id: epicMonsterId,
          slug: 'epic-golem',
          x: 3,
          y: 1,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      round: 1,
      sceneDescription: 'epic fixture',
    });

    await concludeEncounter(epicEncounterId, epicSessionId, userId, 'last_hostile_defeated');

    // Combat XP at 20 follows the table — the level-20 medium band is 5700 — rather than the
    // story path's level-20 zero (#273). The two are separate instruments by design.
    const [epicSheet] = await db
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, epicId));
    expect(epicSheet.xp ?? 0).toBe(5700);
    const epicEvents = await db
      .select()
      .from(experienceEvents)
      .where(eq(experienceEvents.characterId, epicId));
    const epicCombatEvents = epicEvents.filter((event) => event.source === 'combat');
    expect(epicCombatEvents).toHaveLength(1);
    expect(epicCombatEvents[0].xpGained).toBe(5700);
    const [epicEncounter] = await db
      .select({ awarded: combatEncounters.experienceAwarded })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, epicEncounterId));
    expect(epicEncounter.awarded).toBe(5700);

    // #273 untouched: a story award at level 20 still caps at 0 and writes nothing — and the
    // combat event above (source 'combat') does not count toward the story session total.
    const storyOutcome = await awardStoryXpOnce({
      characterId: epicId,
      sessionId: epicSessionId,
      since: new Date(Date.now() - 60_000),
      amount: 500,
      reason: 'epic deed',
    });
    expect(storyOutcome.outcome).toBe('capped');
    const epicEventsAfter = await db
      .select({ source: experienceEvents.source })
      .from(experienceEvents)
      .where(eq(experienceEvents.characterId, epicId));
    expect(epicEventsAfter.filter((event) => event.source === 'other')).toHaveLength(0);

    // The afterAll only knows the shared character; remove this test's own rows.
    await db.delete(experienceEvents).where(eq(experienceEvents.characterId, epicId));
    await db.delete(characters).where(eq(characters.id, epicId));
  });
});

/**
 * #374: the exact 2014 XP award. Each monster's XP is persisted at seating
 * (`combat_participants.xp_value`); on last_hostile_defeated the award is the
 * seated sum split evenly among the player characters. Any monster without a
 * seated value falls back to the difficulty-threshold method with a
 * COMBAT_XP_FALLBACK log.
 */
const { combatVictoryXp } = await importWithRealDb(
  () => import('../combat/combat-xp-mechanics.js'),
);
const loggerModule = await importWithRealDb(() => import('../../lib/logger.js'));

describeWithDb('combat victory XP uses the XP seated on each monster (#374)', () => {
  const getDb = () => realDb();
  const userId = testId('seated-xp-user');
  const createdSessionIds: string[] = [];
  const createdCharacterIds: string[] = [];
  let campaignId: string;

  const sheetXp = async (characterId: string) => {
    const [row] = await getDb()
      .select({ xp: characters.experiencePoints })
      .from(characters)
      .where(eq(characters.id, characterId));
    return row.xp ?? 0;
  };

  /** Stands up campaign -> characters -> session -> encounter -> board, then wins it. */
  const seatAndWin = async (opts: {
    playerCount: number;
    monsterXp: Array<number | null>;
    level?: number;
    difficulty?: string | null;
    /** Neutral NPC allies seated alongside the monsters (xp_value NULL). */
    npcAllies?: number;
  }) => {
    const level = opts.level ?? 3;
    if (!campaignId) {
      [{ id: campaignId }] = await getDb()
        .insert(campaigns)
        .values({ userId, name: testId('seated-xp-camp') })
        .returning({ id: campaigns.id });
    }
    const characterIds: string[] = [];
    for (let i = 0; i < opts.playerCount; i++) {
      const [{ id }] = await getDb()
        .insert(characters)
        .values({ userId, campaignId, name: testId('seated-xp-hero'), level, class: 'Fighter' })
        .returning({ id: characters.id });
      characterIds.push(id);
      createdCharacterIds.push(id);
    }
    const [{ id: sessionId }] = await getDb()
      .insert(gameSessions)
      .values({ campaignId, characterId: characterIds[0], sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);
    const [{ id: encounterId }] = await getDb()
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
        difficulty: opts.difficulty ?? null,
      })
      .returning({ id: combatEncounters.id });
    const values: Array<Record<string, unknown>> = [];
    characterIds.forEach((characterId, i) => {
      values.push({
        encounterId,
        characterId,
        name: `Seated Hero ${i}`,
        participantType: 'player',
        turnOrder: i,
        initiative: 20 - i,
        armorClass: 15,
        maxHp: 40,
        speed: 30,
      });
    });
    opts.monsterXp.forEach((xp, i) => {
      values.push({
        encounterId,
        name: `Seated Monster ${i}`,
        participantType: 'monster',
        turnOrder: opts.playerCount + i,
        initiative: 10 - i,
        armorClass: 12,
        maxHp: 11,
        speed: 30,
        // #374: what the seating step persists — authored XP, the SRD catalog value, or NULL.
        xpValue: xp,
        monsterRef: xp == null ? null : `srd:test-monster-${i}`,
      });
    });
    // Neutral NPC allies: seated as 'npc', never carrying xp_value. They must not
    // force the threshold fallback or pollute the award.
    for (let i = 0; i < (opts.npcAllies ?? 0); i++) {
      values.push({
        encounterId,
        name: `Seated Ally ${i}`,
        participantType: 'npc',
        turnOrder: opts.playerCount + opts.monsterXp.length + i,
        initiative: 5 - i,
        armorClass: 12,
        maxHp: 20,
        speed: 30,
        xpValue: null,
        monsterRef: null,
      });
    }
    const parts = await getDb()
      .insert(combatParticipants)
      .values(values as never)
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    await getDb().insert(combatParticipantStatus).values(
      parts.map((part) => ({
        participantId: part.id,
        currentHp: 40,
        maxHp: 40,
        isConscious: true,
      })),
    );

    await concludeEncounter(encounterId, sessionId, userId, 'last_hostile_defeated');
    return { sessionId, encounterId, characterIds };
  };

  afterAll(async () => {
    if (!hasRealDb) return;
    await getDb()
      .delete(experienceEvents)
      .where(inArray(experienceEvents.characterId, createdCharacterIds));
    const rows = await getDb()
      .select({ id: combatParticipants.id })
      .from(combatParticipants)
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .where(inArray(combatEncounters.sessionId, createdSessionIds));
    await getDb().delete(combatParticipantStatus).where(
      inArray(
        combatParticipantStatus.participantId,
        rows.map((row) => row.id),
      ),
    );
    for (const row of await getDb()
      .select({ id: combatEncounters.id })
      .from(combatEncounters)
      .where(inArray(combatEncounters.sessionId, createdSessionIds))) {
      await getDb().delete(combatParticipants).where(eq(combatParticipants.encounterId, row.id));
    }
    await getDb().delete(combatEncounters).where(inArray(combatEncounters.sessionId, createdSessionIds));
    await getDb().delete(gameSessions).where(inArray(gameSessions.id, createdSessionIds));
    await getDb().delete(characters).where(inArray(characters.id, createdCharacterIds));
    await getDb().delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  test('two seated XP values award their exact sum to a party of one', async () => {
    const { characterIds, encounterId } = await seatAndWin({
      playerCount: 1,
      monsterXp: [50, 100],
    });

    // 50 + 100, one character: the whole sum. The threshold method would have paid 150
    // here too (level 3 medium), so this test pins the mechanism, not the number — the
    // three-way split below is where the numbers diverge.
    expect(await sheetXp(characterIds[0])).toBe(150);
    const [encounter] = await getDb()
      .select({ awarded: combatEncounters.experienceAwarded })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    expect(encounter.awarded).toBe(150);
  });

  test('a party of three splits the seated sum evenly', async () => {
    const { characterIds } = await seatAndWin({ playerCount: 3, monsterXp: [50, 100] });

    // 150 / 3 = 50 each. The threshold fallback would have paid 150 each (level 3
    // medium), so an even split is only reachable through the seated-XP path.
    for (const characterId of characterIds) {
      expect(await sheetXp(characterId)).toBe(50);
    }
  });

  test('seated NPC allies do not force the fallback or pollute the award', async () => {
    const { characterIds } = await seatAndWin({ playerCount: 1, monsterXp: [50, 100], npcAllies: 2 });

    // 50 + 100 = 150 to the one hero. The two 'npc' allies carry NULL xp_value; if the
    // award counted non-player seats as hostiles it would have fallen back to the
    // threshold method instead.
    expect(await sheetXp(characterIds[0])).toBe(150);
  });

  test('one monster without seated XP falls back to the threshold award and logs it', async () => {
    const infoCalls: Array<Record<string, unknown>> = [];
    const info = loggerModule.logger.info;
    loggerModule.logger.info = ((obj: unknown, ...rest: unknown[]) => {
      infoCalls.push(obj as Record<string, unknown>);
      return (info as (...args: unknown[]) => unknown).call(loggerModule.logger, obj, ...rest);
    }) as typeof info;
    try {
      const { characterIds } = await seatAndWin({ playerCount: 1, monsterXp: [50, null] });

      // The threshold method for level 3, no difficulty (reads as medium): 150. The exact
      // path is unreachable with a NULL seated value.
      expect(combatVictoryXp(3, null)).toBe(150);
      expect(await sheetXp(characterIds[0])).toBe(150);
      const fallback = infoCalls.find((call) => call.msg === 'COMBAT_XP_FALLBACK');
      expect(fallback).toMatchObject({ defeatedHostiles: 2, missingXpCount: 1 });
    } finally {
      loggerModule.logger.info = info;
    }
  });
});
