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
