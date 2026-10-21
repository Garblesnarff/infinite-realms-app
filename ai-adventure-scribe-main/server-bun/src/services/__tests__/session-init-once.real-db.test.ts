/**
 * #2386: two overlapping mounts of the game view must leave one "Previously On" recap and one
 * set of opening memories, in a continuation session (`session_number > 1`) as well as a first
 * one.
 *
 * #2379 made the opening scene once-per-session on the server. The same second mount also saved
 * the recap and wrote the four foundational memories again, each under ids or rows the server
 * did not recognise as repeats. Both are checked by a lock on the session row followed by a
 * lookup, which only a real database can exercise: a mocked `db` would run both mounts to
 * completion in sequence and pass against code with no lock at all. It refuses every target
 * except the dedicated local/CI Postgres because it writes fixtures.
 *
 * A mount here is what `use-initial-greeting.ts` does, in its order: save the recap (continuation
 * sessions only), save the greeting, then write the opening memories one request at a time. The
 * bodies are the shared fixtures the client tests pin to the real producers.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { asc, eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import { campaigns, dialogueHistory, gameSessions, memories } from '../../../../db/schema/index';
import {
  previouslyOnWireBody,
  initialMemoryWireBodies,
} from '../../../../shared/test-fixtures/continuation-session-init-save';
import { initialGreetingWireBody } from '../../../../shared/test-fixtures/initial-greeting-save';

if (hasRealDb) {
  const target = new URL(realDbUrl);
  if (target.hostname !== '127.0.0.1' || target.port !== '55432') {
    throw new Error(
      `[session-init-once] refusing real-DB fixtures against ${target.hostname}:${target.port}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

// The services import the server's eager environment guard, as in
// session-initial-greeting.real-db.test.ts. The database job supplies the real URL separately.
process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const { SessionMessageService } = await importWithRealDb(
  () => import('../session/session-message-service.js'),
);
const { MemoryService } = await importWithRealDb(() => import('../memory-service.js'));
const { latestRollOutcome } = await importWithRealDb(() => import('../dm/narration-outcome.js'));

if (!hasRealDb) {
  console.warn(
    '[session-init-once] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

type MessageInput = Parameters<typeof SessionMessageService.addMessages>[0][number];
type MemoryInput = Parameters<typeof MemoryService.insert>[0][number];

/** A message exactly as the route hands it to the service: the client's wire body, mapped. */
const fromWireBody = (sessionId: string, wire: Record<string, unknown>): MessageInput => {
  const body = wire as {
    id: string;
    message: string;
    speaker_type: string;
    context: Record<string, unknown>;
    timestamp: string;
  };
  return {
    id: body.id,
    sessionId,
    speakerType: body.speaker_type,
    message: body.message,
    context: body.context,
    timestamp: new Date(body.timestamp),
  };
};

/** A memory exactly as `POST /v1/memories` hands it to the service: the wire body, mapped. */
const toMemoryRecord = (wire: Record<string, unknown>): MemoryInput => ({
  sessionId: wire.session_id as string,
  type: wire.type as string,
  subcategory: wire.subcategory as string,
  content: wire.content as string,
  importance: wire.importance as number,
  metadata: wire.metadata,
});

describeWithDb('session init is saved once per session (#2386)', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  const userId = `session-init-once-user-${process.pid}`;
  let campaignId = '';
  const sessionIds: string[] = [];
  // No embedding key or alert webhook: every memory insert fires its embedding off the request's
  // clock, and this suite must not call out to Google or Slack.
  const savedEnv = new Map<string, string | undefined>();
  const EMBEDDING_ENV = ['GOOGLE_GEMINI_API_KEY', 'GOOGLE_API_KEY', 'SLACK_ALERT_WEBHOOK_URL'];

  const newSession = async (sessionNumber: number): Promise<string> => {
    const [{ id }] = await database
      .insert(gameSessions)
      .values({ campaignId, sessionNumber, status: 'active' })
      .returning({ id: gameSessions.id });
    sessionIds.push(id);
    return id;
  };

  /**
   * One mount of the game view's init, in `use-initial-greeting.ts` order. Each mount mints its own
   * message ids, as the client does; `dialogue_history.id` is a primary key across all sessions,
   * so ids reused between sessions would be dropped as id conflicts and prove nothing.
   */
  const mount = async (
    sessionId: string,
    { continuation }: { continuation: boolean },
  ): Promise<{ memoryIds: string[]; recapId?: string }> => {
    const recapId = continuation ? crypto.randomUUID() : undefined;
    if (recapId) {
      await SessionMessageService.addMessages(
        [fromWireBody(sessionId, previouslyOnWireBody(recapId))],
        userId,
      );
    }
    await SessionMessageService.addMessages(
      [fromWireBody(sessionId, initialGreetingWireBody(crypto.randomUUID()))],
      userId,
    );
    const memoryIds: string[] = [];
    for (const wire of initialMemoryWireBodies(sessionId)) {
      const [row] = await MemoryService.insert([toMemoryRecord(wire)], userId);
      memoryIds.push(row!.id);
    }
    return { memoryIds, recapId };
  };

  const messagesFor = (sessionId: string): Promise<(typeof dialogueHistory.$inferSelect)[]> =>
    database
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, sessionId))
      .orderBy(asc(dialogueHistory.createdAt));
  const memoriesFor = async (sessionId: string): Promise<{ id: string; key: string }[]> =>
    (
      await database
        .select({
          id: memories.id,
          type: memories.type,
          subcategory: memories.subcategory,
        })
        .from(memories)
        .where(eq(memories.sessionId, sessionId))
    )
      .map((row) => ({ id: row.id, key: `${row.type}/${row.subcategory}` }))
      .sort((a, b) => a.key.localeCompare(b.key));
  const turnCount = async (sessionId: string): Promise<number> =>
    (
      await database
        .select({ turnCount: gameSessions.turnCount })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId))
    )[0]?.turnCount ?? 0;

  const OPENING_MEMORY_KEYS = [
    'atmosphere/environment',
    'character_moment/player',
    'location/current_location',
    'world_detail/general',
  ];
  const marks = (rows: (typeof dialogueHistory.$inferSelect)[], mark: string): number =>
    rows.filter((row) => (row.context as Record<string, unknown> | null)?.[mark] === true).length;

  beforeAll(async () => {
    for (const name of EMBEDDING_ENV) {
      savedEnv.set(name, process.env[name]);
      delete process.env[name];
    }
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('session-init-once-campaign') })
      .returning({ id: campaigns.id });
  });

  afterAll(async () => {
    try {
      for (const id of sessionIds) {
        await database.delete(gameSessions).where(eq(gameSessions.id, id));
      }
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      for (const [name, value] of savedEnv) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await closeRealDb();
    }
  });

  test('continuation session: two overlapping mounts persist one recap, one greeting and one set of opening memories', async () => {
    const sessionId = await newSession(2);

    const [first, second] = await Promise.all([
      mount(sessionId, { continuation: true }),
      mount(sessionId, { continuation: true }),
    ]);

    const rows = await messagesFor(sessionId);
    expect(rows).toHaveLength(2);
    expect(marks(rows, 'previously_on')).toBe(1);
    expect(marks(rows, 'initial_greeting')).toBe(1);
    const stored = await memoriesFor(sessionId);
    expect(stored.map((row) => row.key)).toEqual(OPENING_MEMORY_KEYS);
    // Both mounts are told about the one set that exists, so neither sees an empty save.
    expect(first.memoryIds.sort()).toEqual(stored.map((row) => row.id).sort());
    expect(second.memoryIds.sort()).toEqual(stored.map((row) => row.id).sort());
    // The recap and the greeting are each counted once.
    expect(await turnCount(sessionId)).toBe(2);
  });

  test('continuation session: a burst of overlapping mounts still leaves one of each', async () => {
    const sessionId = await newSession(3);

    await Promise.all(Array.from({ length: 6 }, () => mount(sessionId, { continuation: true })));

    const rows = await messagesFor(sessionId);
    expect(marks(rows, 'previously_on')).toBe(1);
    expect(marks(rows, 'initial_greeting')).toBe(1);
    expect((await memoriesFor(sessionId)).map((row) => row.key)).toEqual(OPENING_MEMORY_KEYS);
    expect(await turnCount(sessionId)).toBe(2);
  });

  test('a late mount after the first has finished loads the stored rows instead of adding more', async () => {
    const sessionId = await newSession(2);
    const { memoryIds, recapId } = await mount(sessionId, { continuation: true });

    const late = await SessionMessageService.addMessages(
      [fromWireBody(sessionId, previouslyOnWireBody(crypto.randomUUID()))],
      userId,
    );
    const lateMemories = await MemoryService.insert(
      initialMemoryWireBodies(sessionId).map(toMemoryRecord),
      userId,
    );

    expect(late.map((row) => row.id)).toEqual([recapId!]);
    // One batch, in the order it was sent, each record answered by the row already stored.
    expect(lateMemories.map((row) => row.id)).toEqual(memoryIds);
    expect(marks(await messagesFor(sessionId), 'previously_on')).toBe(1);
    expect(await memoriesFor(sessionId)).toHaveLength(4);
  });

  test('a first session is unchanged: no recap, one greeting, one set of memories, whether it mounts once or twice', async () => {
    const single = await newSession(1);
    const doubled = await newSession(1);

    await mount(single, { continuation: false });
    await Promise.all([
      mount(doubled, { continuation: false }),
      mount(doubled, { continuation: false }),
    ]);

    for (const sessionId of [single, doubled]) {
      const rows = await messagesFor(sessionId);
      expect(rows).toHaveLength(1);
      expect(marks(rows, 'initial_greeting')).toBe(1);
      expect(marks(rows, 'previously_on')).toBe(0);
      expect((await memoriesFor(sessionId)).map((row) => row.key)).toEqual(OPENING_MEMORY_KEYS);
      expect(await turnCount(sessionId)).toBe(1);
    }
  });

  test('other rows are untouched: memories without the mark, another session own set, recap and greeting independent', async () => {
    const sessionId = await newSession(2);
    const otherSessionId = await newSession(2);
    const [characterMemory] = initialMemoryWireBodies(sessionId);

    // A memory of the same type and subcategory that the opening did not write (no mark) is not
    // an opening memory and must neither be returned in its place nor block the real one.
    const [extracted] = await MemoryService.insert(
      [
        toMemoryRecord({
          ...characterMemory,
          content: 'Mira picked the lock of the cellar door.',
          metadata: { category: 'extraction' },
        }),
      ],
      userId,
    );
    // The recap alone does not stand in for the greeting, nor the greeting for the recap.
    await SessionMessageService.addMessages(
      [fromWireBody(sessionId, previouslyOnWireBody(crypto.randomUUID()))],
      userId,
    );
    await mount(sessionId, { continuation: false });
    await mount(otherSessionId, { continuation: true });

    const rows = await messagesFor(sessionId);
    expect(marks(rows, 'previously_on')).toBe(1);
    expect(marks(rows, 'initial_greeting')).toBe(1);
    const stored = await memoriesFor(sessionId);
    expect(stored).toHaveLength(5);
    expect(stored.map((row) => row.id)).toContain(extracted!.id);
    expect(stored.filter((row) => row.key === 'character_moment/player')).toHaveLength(2);
    const otherRows = await messagesFor(otherSessionId);
    expect(marks(otherRows, 'previously_on')).toBe(1);
    expect(marks(otherRows, 'initial_greeting')).toBe(1);
    expect((await memoriesFor(otherSessionId)).map((row) => row.key)).toEqual(OPENING_MEMORY_KEYS);
  });
});

/**
 * #266 FIX round: `latestRollOutcome` reads the turn's authoritative roll from the session
 * state. Only a real database can exercise this: the query joins the newest `roll_result`
 * combatLog entry against the latest DM message's timestamp, and a mocked `db` would pass
 * against SQL that never matches a row. It refuses every target except the dedicated
 * local/CI Postgres because it writes fixtures.
 */
describeWithDb('latestRollOutcome reads the current turn’s roll (#266)', () => {
  const userId = `narration-outcome-user-${process.pid}`;
  let campaignId = '';
  const sessionIds: string[] = [];

  // The database handle is acquired per hook, not per block: an earlier block's afterAll
  // closes the shared client, and realDb() reopens it on demand.
  const db = (): ReturnType<typeof realDb> => realDb();

  /** A combatLog entry exactly as the client persists a roll_result. */
  const rollEntry = (
    timestamp: string,
  ): { timestamp: string; entry: { kind: string; payload: Record<string, unknown> } } => ({
    timestamp,
    entry: {
      kind: 'roll_result',
      payload: {
        success: false,
        total: 7,
        dc: 14,
        requestType: 'skill_check',
        description: 'Stealth check to climb the shaft unheard',
      },
    },
  });

  const newSession = async (combatLog: unknown[]): Promise<string> => {
    const [{ id }] = await db()
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active', sessionState: { combatLog } })
      .returning({ id: gameSessions.id });
    sessionIds.push(id);
    return id;
  };

  const addDmMessage = async (sessionId: string, at: Date): Promise<void> => {
    await db().insert(dialogueHistory).values({
      sessionId,
      speakerType: 'dm',
      message: 'The shadows deepen around you.',
      timestamp: at,
    });
  };

  beforeAll(async () => {
    [{ id: campaignId }] = await db()
      .insert(campaigns)
      .values({ userId, name: testId('narration-outcome-campaign') })
      .returning({ id: campaigns.id });
  });

  afterAll(async () => {
    for (const id of sessionIds) {
      await db().delete(gameSessions).where(eq(gameSessions.id, id));
    }
    if (campaignId) await db().delete(campaigns).where(eq(campaigns.id, campaignId));
  });

  test('returns the fresh roll when no DM message follows it', async () => {
    const sessionId = await newSession([rollEntry(new Date().toISOString())]);
    const outcome = await latestRollOutcome(sessionId);
    expect(outcome?.success).toBe(false);
    expect(outcome?.total).toBe(7);
    expect(outcome?.dc).toBe(14);
    expect(outcome?.description).toBe('Stealth check to climb the shaft unheard');
  });

  test('ignores a roll from before the latest DM message (a previous turn’s roll)', async () => {
    const sessionId = await newSession([
      rollEntry(new Date(Date.now() - 5 * 60 * 1000).toISOString()),
    ]);
    await addDmMessage(sessionId, new Date());
    expect(await latestRollOutcome(sessionId)).toBeNull();
  });

  test('ignores a roll older than 15 minutes', async () => {
    const sessionId = await newSession([
      rollEntry(new Date(Date.now() - 16 * 60 * 1000).toISOString()),
    ]);
    expect(await latestRollOutcome(sessionId)).toBeNull();
  });

  test('ignores a roll with a bad timestamp', async () => {
    const sessionId = await newSession([rollEntry('not-a-timestamp')]);
    expect(await latestRollOutcome(sessionId)).toBeNull();
  });

  test('ignores a session with no roll_result entries', async () => {
    const sessionId = await newSession([]);
    expect(await latestRollOutcome(sessionId)).toBeNull();
  });

  test('a typed (raw-only) roll mention does not shadow the real roll below it', async () => {
    // The client logs a typed "I rolled 17" as roll_result with payload
    // { total, raw } and no success flag (session-logger.ts logTextRollResult):
    // no engine verdict of its own, so the search skips it (#266 round 2).
    const rawEntry = {
      timestamp: new Date().toISOString(),
      entry: { kind: 'roll_result', payload: { total: 17, raw: 'I rolled 17' } },
    };
    const sessionId = await newSession([rollEntry(new Date().toISOString()), rawEntry]);
    const outcome = await latestRollOutcome(sessionId);
    expect(outcome?.success).toBe(false);
    expect(outcome?.total).toBe(7);
  });

  test('an outcome-less real roll stops the search instead of surfacing an older roll', async () => {
    // A damage roll / untargeted check carries a total and no verdict, and is
    // NOT a text-parsed mention (no raw): the search stops there.
    const verdictless = {
      timestamp: new Date().toISOString(),
      entry: { kind: 'roll_result', payload: { total: 12 } },
    };
    const sessionId = await newSession([rollEntry(new Date().toISOString()), verdictless]);
    expect(await latestRollOutcome(sessionId)).toBeNull();
  });

  test('the exchange start reads the DM message’s server created_at, not its client timestamp', async () => {
    const sessionId = await newSession([
      rollEntry(new Date(Date.now() - 30 * 1000).toISOString()),
    ]);
    // Client clock an hour fast: the client-supplied timestamp would exile the
    // fresh roll as a previous turn's; the server created_at places it in this
    // exchange (#266 follow-up; AGENTS.md §4).
    await db().insert(dialogueHistory).values({
      sessionId,
      speakerType: 'dm',
      message: 'The shadows deepen around you.',
      timestamp: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 60 * 1000),
    });
    const outcome = await latestRollOutcome(sessionId);
    expect(outcome?.total).toBe(7);
  });
});
