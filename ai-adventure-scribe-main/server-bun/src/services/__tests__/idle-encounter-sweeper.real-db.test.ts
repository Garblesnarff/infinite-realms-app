/* eslint-disable max-lines -- one fixture (campaign -> character -> session -> encounter ->
   board -> dialogue) rebuilt per test, because each sweep tears down the board and closes the
   encounter it is given. Splitting the file would mean standing up the same chain twice, and the
   sweeper is global: every assertion has to run against the same database state the job sees. */
/**
 * #2556: an abandoned encounter closes itself, and only an abandoned one does.
 *
 * Prod carried 42 `combat_encounters` rows still `active`, the oldest from 2026-07-25. Each was
 * closed by hand on an ops session with a typed line from Rob, which is not a rule. The rule is
 * the hourly sweep, and it closes them through `concludeEncounter` so the DM note, the board
 * teardown and the client update all happen -- a raw UPDATE would produce the exact hole run 18's
 * encounter 2 was.
 *
 * This runs against real PostgreSQL because the selection IS the logic under test. A mocked `db`
 * cannot decide whether a `NOT EXISTS` over `dialogue_history` matches a row that has a recent DM
 * message and one that has only a recent `system` line, and a mocked "update was called" passes
 * happily against a query that never matches.
 *
 * Fixtures are built the way production builds them: a campaign (the owner `concludeEncounter`
 * needs, since `game_sessions` has no `user_id` of its own), a character with stats, a session, an
 * encounter with participants and a live tactical map -- the same chain
 * `encounter-ending-reason.real-db.test.ts` builds -- plus `dialogue_history` rows written with the
 * `speaker_type` the real producers write ('player', 'dm', 'system').
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

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
  gameSessions,
  tacticalMaps,
} from '../../../../db/schema/index';

import type { NewDialogueHistory } from '../../../../db/schema/index';

const realEnding = await importWithRealDb(() => import('../combat/combat-ending.js'));
const { describeCombatEnd } = realEnding;
const { consumeDmTacticalFacts } = await importWithRealDb(
  () => import('../combat/tactical-action-service.js'),
);
const { saveTacticalMap } = await importWithRealDb(() => import('../combat/tactical-map-store.js'));

/**
 * Encounters whose close should throw, so the per-row failure path can be exercised against a
 * real database rather than a mocked one.
 *
 * The wrapper DELEGATES to the real `concludeEncounter` for every id not in the set, so every
 * other test in this file still closes its fights through the real funnel. The real function is
 * captured from the import ABOVE, before the mock is registered -- importing it again inside the
 * factory would return the mocked namespace and recurse forever.
 *
 * It forwards every argument (`...args`), NOT a hand-written parameter list. `mock.module`'s
 * registry is process-wide, so this registration reaches every other suite the CI real-DB job
 * runs in the same `bun test` invocation -- `run-isolated-tests.ts` isolates, that job does not.
 * An earlier version declared only the first four parameters and silently dropped the `options`
 * argument, which broke `encounter-ending-reason.real-db.test.ts`'s #2524 fled-exit tests in CI
 * while every local run of this file alone passed. Forwarding the real signature means a later
 * argument can never be dropped again.
 */
const failingEncounterIds = new Set<string>();
if (hasRealDb) {
  const realConcludeEncounter = realEnding.concludeEncounter;
  mock.module('../combat/combat-ending.js', () => ({
    ...realEnding,
    concludeEncounter: async (
      ...args: Parameters<typeof realConcludeEncounter>
    ): ReturnType<typeof realConcludeEncounter> => {
      if (failingEncounterIds.has(args[0])) {
        throw new Error('simulated close failure');
      }
      return realConcludeEncounter(...args);
    },
  }));
}

const { sweepIdleEncounters, runIdleEncounterSweepTick, IDLE_ENCOUNTER_HOURS } =
  await importWithRealDb(() => import('../combat/idle-encounter-sweeper.js'));
if (!hasRealDb) {
  console.warn(
    '[idle-encounter-sweeper] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

describeWithDb('the idle sweep closes abandoned encounters and spares live ones', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('idle-user');

  const createdSessionIds: string[] = [];

  /**
   * Campaign -> character -> session -> encounter -> participants -> live board.
   *
   * `ageHours` backdates every clock the sweep reads -- the encounter's `started_at`,
   * `created_at` and `updated_at`, and the board's `updated_at`. Defaulting it to well past the
   * window is what makes these fixtures represent an ABANDONED fight; the tests that need a live
   * one pass a small value and assert it survives. Seeding a fight with fresh clocks and no
   * dialogue and expecting it closed was the bug the review caught: that is a fight someone has
   * just started, not one nobody returned to.
   */
  const seedSession = async (label: string, ageHours = IDLE_ENCOUNTER_HOURS + 48) => {
    const age = hoursAgo(ageHours);
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId(`idle-campaign-${label}`) })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId(`idle-hero-${label}`),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      armorClass: 15,
      maxHitPoints: 40,
      currentHitPoints: 40,
      speed: 30,
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);

    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
        startedAt: age,
        createdAt: age,
        updatedAt: age,
      })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'Idle Hero',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 15,
          maxHp: 40,
          speed: 30,
        },
        {
          encounterId,
          name: 'Idle Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 12,
          // Still standing, like every encounter this rule exists to close.
          maxHp: 11,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    await db.insert(combatParticipantStatus).values(
      inserted.map((row) => ({
        participantId: row.id,
        currentHp: row.turnOrder === 0 ? 40 : 2,
        maxHp: row.turnOrder === 0 ? 40 : 11,
        isConscious: true,
      })),
    );

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
      entities: inserted.map((row, index) => ({
        id: row.id,
        slug: index === 0 ? 'idle-hero' : 'idle-golem',
        x: index + 1,
        y: 1,
        size: 'medium' as const,
        type: index === 0 ? ('pc' as const) : ('monster' as const),
        speedFeet: 30,
        movementRemaining: 30,
      })),
      round: 1,
      sceneDescription: `idle fixture ${label}`,
    });
    // `saveTacticalMap` always stamps `updated_at` with now(), so the board is backdated here
    // rather than in the store call. The sweep reads this column, and a board that looks freshly
    // written is exactly what a live fight looks like.
    await db
      .update(tacticalMaps)
      .set({ updatedAt: age })
      .where(eq(tacticalMaps.sessionId, sessionId));
    await consumeDmTacticalFacts(sessionId);

    return { sessionId, encounterId };
  };

  /**
   * Written the way the real producers write dialogue rows (see the suite header).
   *
   * Both clocks are set from `at`, because the row is being planted as if it had been written at
   * that moment: `created_at` is the server's `defaultNow` at insert and `timestamp` is the
   * client's own value, and in production they agree to within the round trip. The clock-skew
   * test overrides them apart deliberately.
   */
  const speak = async (
    sessionId: string,
    speakerType: 'player' | 'dm' | 'system',
    at: Date,
    overrides: Partial<Pick<NewDialogueHistory, 'timestamp' | 'createdAt'>> = {},
  ) => {
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType,
      message: `${speakerType} line at ${at.toISOString()}`,
      timestamp: at,
      createdAt: at,
      ...overrides,
    });
  };

  const encounterRow = async (encounterId: string) => {
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

  const dropSeededSessions = async () => {
    if (createdSessionIds.length === 0) return;
    await db.delete(dialogueHistory).where(inArray(dialogueHistory.sessionId, createdSessionIds));
    await db.delete(tacticalMaps).where(inArray(tacticalMaps.sessionId, createdSessionIds));
    await db.delete(combatEncounters).where(inArray(combatEncounters.sessionId, createdSessionIds));
    await db.delete(gameSessions).where(inArray(gameSessions.id, createdSessionIds));
    createdSessionIds.length = 0;
  };

  beforeEach(async () => {
    // The sweeper is global: it looks at every active encounter in the database. A leftover
    // active fixture from a previous test would be closed and reported as this test's work, so
    // each test starts from the sessions this suite created and nothing else.
    if (!hasRealDb) return;
    await dropSeededSessions();
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await dropSeededSessions();
    await closeRealDb();
  });

  test('the idle window is a day, and an encounter is spare right up to its edge', async () => {
    // Asserted by where the boundary sits rather than by comparing the constant to 24: the
    // window is only real if the selection actually honours it.
    expect(IDLE_ENCOUNTER_HOURS).toBe(24);

    const justInside = await seedSession('window-inside');
    await speak(justInside.sessionId, 'dm', hoursAgo(IDLE_ENCOUNTER_HOURS - 1));
    const justOutside = await seedSession('window-outside');
    await speak(justOutside.sessionId, 'dm', hoursAgo(IDLE_ENCOUNTER_HOURS + 1));

    const result = await sweepIdleEncounters();

    expect(result.closed).toContain(justOutside.encounterId);
    expect(result.closed).not.toContain(justInside.encounterId);
  });

  test('a fight started five minutes ago in a quiet session is NOT swept', async () => {
    // `startCombat` inserts the encounter row and writes no dialogue. A player who walks back
    // into a session that has been silent for a week and starts a fight must not have it closed
    // at the next hourly tick. This is the bug the review found: dialogue alone was the only
    // clock being read.
    const { sessionId, encounterId } = await seedSession('just-started', 5 / 60);
    // Silent for three days, but the fight itself began five minutes ago.
    await speak(sessionId, 'dm', hoursAgo(72));

    const result = await sweepIdleEncounters();

    expect(result.closed).not.toContain(encounterId);
    const row = await encounterRow(encounterId);
    expect(row.status).toBe('active');
    expect(row.endedReason).toBeNull();
    expect(row.endedAt).toBeNull();
  });

  test('an encounter the engine touched an hour ago is NOT swept, dialogue or not', async () => {
    // Old fight, silent session, but `combat_encounters.updated_at` moved: turn advance and turn
    // claims set it, so this is a fight that is still being played at the engine level.
    const { sessionId, encounterId } = await seedSession('engine-live', IDLE_ENCOUNTER_HOURS + 48);
    await speak(sessionId, 'dm', hoursAgo(72));
    await db
      .update(combatEncounters)
      .set({ updatedAt: hoursAgo(1) })
      .where(eq(combatEncounters.id, encounterId));

    const result = await sweepIdleEncounters();

    expect(result.closed).not.toContain(encounterId);
    expect((await encounterRow(encounterId)).status).toBe('active');
  });

  test('a board touched an hour ago is NOT swept, because HP and movement never touch the encounter', async () => {
    // `CombatHPService.applyDamage` only joins `combat_encounters`; it never updates it. Map
    // writes are what move for damage and movement, so their clock has to count too.
    const { sessionId, encounterId } = await seedSession('board-live', IDLE_ENCOUNTER_HOURS + 48);
    await speak(sessionId, 'dm', hoursAgo(72));
    await db
      .update(tacticalMaps)
      .set({ updatedAt: hoursAgo(1) })
      .where(eq(tacticalMaps.sessionId, sessionId));

    const result = await sweepIdleEncounters();

    expect(result.closed).not.toContain(encounterId);
    expect((await encounterRow(encounterId)).status).toBe('active');
  });

  test('an encounter whose started_at is inside the window is NOT swept, however old its row', async () => {
    // `started_at` is set explicitly by `startCombat` and need not equal the row's own
    // `created_at`, so a fight that began five minutes ago can sit on a row inserted days ago.
    // Without its own predicate the encounter's `updated_at`/`created_at` would let that fight be
    // closed, which is the bug this whole item is about.
    const { sessionId, encounterId } = await seedSession('started-recent');
    await speak(sessionId, 'dm', hoursAgo(72));
    await db
      .update(combatEncounters)
      .set({ startedAt: hoursAgo(5 / 60) })
      .where(eq(combatEncounters.id, encounterId));

    const result = await sweepIdleEncounters();

    expect(result.closed).not.toContain(encounterId);
    expect((await encounterRow(encounterId)).status).toBe('active');
  });

  test('an encounter whose session went quiet is closed with ended_idle, through the real funnel', async () => {
    const { sessionId, encounterId } = await seedSession('abandoned');
    // A fight whose last word was three days ago.
    await speak(sessionId, 'player', hoursAgo(48));
    await speak(sessionId, 'dm', hoursAgo(72));

    const result = await sweepIdleEncounters();

    expect(result.closed).toContain(encounterId);
    const row = await encounterRow(encounterId);
    expect(row.status).toBe('completed');
    expect(row.endedReason).toBe('ended_idle');
    expect(row.endedAt).not.toBeNull();
    // Not a raw UPDATE: the DM is handed the sentence to narrate, which is the whole reason the
    // cleanup used `concludeEncounter` by hand.
    expect(await consumeDmTacticalFacts(sessionId)).toEqual([describeCombatEnd('ended_idle')]);
  });

  test('an encounter whose session spoke recently is left running', async () => {
    const { sessionId, encounterId } = await seedSession('live');
    // Started long ago, but the DM answered two hours ago: this player came back.
    await speak(sessionId, 'dm', hoursAgo(2));

    const result = await sweepIdleEncounters();

    expect(result.closed).not.toContain(encounterId);
    const row = await encounterRow(encounterId);
    expect(row.status).toBe('active');
    expect(row.endedReason).toBeNull();
    expect(row.endedAt).toBeNull();
  });

  test('a player line stamped in the future by a wrong client clock does not pin a fight open', async () => {
    // `dialogue_history.timestamp` is written from the browser. If the sweeper read that column,
    // a machine a day fast would make every abandoned encounter look live, forever.
    const { sessionId, encounterId } = await seedSession('clock-skew');
    const tomorrow = new Date(Date.now() + 24 * HOUR_MS);
    await speak(sessionId, 'player', tomorrow, { timestamp: tomorrow, createdAt: hoursAgo(72) });

    const result = await sweepIdleEncounters();

    expect(result.closed).toContain(encounterId);
    expect((await encounterRow(encounterId)).endedReason).toBe('ended_idle');
  });

  test('a recent player line spares the fight as surely as a recent DM line', async () => {
    const { sessionId, encounterId } = await seedSession('player-live');
    await speak(sessionId, 'player', hoursAgo(1));

    await sweepIdleEncounters();

    expect((await encounterRow(encounterId)).status).toBe('active');
  });

  test('a recent system line is not play, so the fight still closes', async () => {
    // A declined roll or a refused action writes a `system` row with nobody present (#2291).
    // Counting it as activity would keep every abandoned encounter alive forever.
    const { sessionId, encounterId } = await seedSession('system-only');
    await speak(sessionId, 'system', hoursAgo(1));

    await sweepIdleEncounters();

    const row = await encounterRow(encounterId);
    expect(row.status).toBe('completed');
    expect(row.endedReason).toBe('ended_idle');
  });

  test('a closed encounter is never touched twice', async () => {
    const { sessionId, encounterId } = await seedSession('twice');
    await speak(sessionId, 'dm', hoursAgo(72));

    const first = await sweepIdleEncounters();
    const afterFirst = await encounterRow(encounterId);

    const second = await sweepIdleEncounters();
    const afterSecond = await encounterRow(encounterId);

    expect(first.closed).toContain(encounterId);
    // The second run has nothing left to close: the row is no longer `active`.
    expect(second.closed).not.toContain(encounterId);
    // One terminal transition, not two: the claim inside `concludeEncounter` stops the retry
    // before it can rewrite the reason or move the timestamp.
    expect(afterSecond.status).toBe('completed');
    expect(afterSecond.endedReason).toBe('ended_idle');
    expect(afterSecond.endedReason).toBe(afterFirst.endedReason);
    expect(afterSecond.endedAt?.getTime()).toBe(afterFirst.endedAt?.getTime());
  });

  test('running the job twice in a row closes every idle encounter exactly once', async () => {
    const first = await seedSession('idempotent-a');
    await speak(first.sessionId, 'player', hoursAgo(72));
    const second = await seedSession('idempotent-b');
    await speak(second.sessionId, 'dm', hoursAgo(96));
    const live = await seedSession('idempotent-live');
    await speak(live.sessionId, 'dm', hoursAgo(3));
    const allIds = [first.encounterId, second.encounterId, live.encounterId];

    const firstRun = await sweepIdleEncounters();
    const rowsAfterFirst = await Promise.all(allIds.map(encounterRow));

    const secondRun = await sweepIdleEncounters();

    // Subset assertions, not exact equality on the whole database: the sweep is global, so an
    // unrelated active encounter left by another suite would otherwise fail this test -- and be
    // closed by it, which is the sweep behaving correctly, not a defect.
    const idleIds = [first.encounterId, second.encounterId];
    expect(firstRun.closed).toEqual(expect.arrayContaining(idleIds));
    expect(firstRun.closed).not.toContain(live.encounterId);
    expect(firstRun.failed).toEqual([]);
    expect(secondRun.closed).not.toContain(live.encounterId);
    expect(secondRun.failed).toEqual([]);
    for (const id of idleIds) expect(secondRun.closed).not.toContain(id);
    // Every row identical after the second pass, including the live one it never touched.
    expect(await Promise.all(allIds.map(encounterRow))).toEqual(rowsAfterFirst);
    expect(rowsAfterFirst.map((row) => row.status)).toEqual(['completed', 'completed', 'active']);
  });

  /**
   * A session with no campaign, planted straight through the schema.
   *
   * `seedSession` always creates a campaign, so the owner-fallback branches need their own path.
   * `characterId: null` gives the no-owner case; a character with no campaign owner gives the
   * second `coalesce` branch, `characters.userId`.
   */
  const seedOrphanSession = async (
    label: string,
    character: { userId: string } | null,
    ageHours = IDLE_ENCOUNTER_HOURS + 48,
  ) => {
    const age = hoursAgo(ageHours);
    let characterId: string | null = null;
    if (character) {
      [{ id: characterId }] = await db
        .insert(characters)
        .values({
          userId: character.userId,
          name: testId(`idle-orphan-${label}`),
          level: 3,
          class: 'Fighter',
        })
        .returning({ id: characters.id });
    }
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId: null, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    createdSessionIds.push(sessionId);
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        version: 1,
        startedAt: age,
        createdAt: age,
        updatedAt: age,
      })
      .returning({ id: combatEncounters.id });
    return { sessionId, encounterId };
  };

  test('a session with no campaign still closes, through its character owner', async () => {
    // `session-service.ts` creates character-only sessions with `campaignId: null`. An inner
    // join on campaigns would leave these exempt from the rule forever, silently.
    const { encounterId } = await seedOrphanSession('no-campaign', { userId });

    const result = await sweepIdleEncounters();

    expect(result.closed).toContain(encounterId);
    expect((await encounterRow(encounterId)).endedReason).toBe('ended_idle');
  });

  test('a session whose character user_id differs from any campaign owner still closes', async () => {
    // The second `coalesce` branch. The character belongs to somebody else and there is no
    // campaign to name an owner, so the sweep acts as `characters.userId` -- the only owner the
    // query can reach, because `characters.user_id` is NOT NULL.
    const { encounterId } = await seedOrphanSession('character-user-id', {
      userId: testId('idle-somebody-else'),
    });

    const result = await sweepIdleEncounters();

    expect(result.closed).toContain(encounterId);
    expect((await encounterRow(encounterId)).endedReason).toBe('ended_idle');
  });

  test('a session with no owner at all is reported, never silently dropped', async () => {
    const { encounterId } = await seedOrphanSession('no-owner', null);

    const result = await sweepIdleEncounters();

    // Nobody to act as, so nothing is written -- but the id is reported, so this is visible
    // rather than an encounter that quietly outlives the rule.
    expect(result.skipped).toContain(encounterId);
    expect(result.closed).not.toContain(encounterId);
    expect((await encounterRow(encounterId)).status).toBe('active');
  });

  test('one encounter failing to close does not strand the others, and the sweep still returns', async () => {
    // The per-row try/catch is what stops a single bad encounter from taking the whole hourly
    // pass down with it -- which is the difference between one stale row and dozens.
    const good = await seedSession('failure-good');
    await speak(good.sessionId, 'dm', hoursAgo(72));
    const bad = await seedSession('failure-bad');
    await speak(bad.sessionId, 'dm', hoursAgo(72));
    failingEncounterIds.add(bad.encounterId);

    try {
      const result = await sweepIdleEncounters();

      expect(result.failed).toEqual([bad.encounterId]);
      expect(result.closed).toContain(good.encounterId);
      expect(result.closed).not.toContain(bad.encounterId);
      // The healthy one really did go through the funnel.
      expect((await encounterRow(good.encounterId)).endedReason).toBe('ended_idle');
      // And the failed one is untouched, so the next hour retries it rather than losing it.
      expect((await encounterRow(bad.encounterId)).status).toBe('active');
    } finally {
      failingEncounterIds.clear();
    }
  });

  test('a tick whose sweep throws is swallowed, and the next tick still runs', async () => {
    // `setInterval(() => void sweep())` would hand this rejection to the process-wide
    // unhandledRejection handler in index.ts, which logs the whole promise object.
    const calls: number[] = [];
    await runIdleEncounterSweepTick(async () => {
      calls.push(1);
      throw new Error('database blip');
    });

    expect(calls).toHaveLength(1);
    // The in-flight flag is released in the `finally`, so a failure does not wedge the job off
    // for the rest of the process's life.
    await runIdleEncounterSweepTick(async () => {
      calls.push(1);
    });
    expect(calls).toHaveLength(2);
  });

  test('two ticks at once run one sweep, not two', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowSweep = async () => {
      calls += 1;
      await gate;
    };

    const first = runIdleEncounterSweepTick(slowSweep);
    const second = runIdleEncounterSweepTick(slowSweep);
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    // And the flag is clear afterwards, so the next hour is not skipped forever.
    await runIdleEncounterSweepTick(slowSweep);
    expect(calls).toBe(2);
  });
});
