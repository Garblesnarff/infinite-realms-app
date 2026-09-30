/**
 * #2379: two overlapping saves of the opening scene for one new session must leave exactly one
 * greeting row.
 *
 * The game view can mount twice before the first greeting lands, and each mount saves its copy
 * under its own client-minted id, so the primary key cannot dedupe them. The check is a row lock
 * on the session followed by a lookup, which only a real database can exercise: a mocked `db`
 * would run both saves to completion in sequence and pass against code with no lock at all. It
 * refuses every target except the dedicated local/CI Postgres because it writes fixtures.
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
import { campaigns, dialogueHistory, gameSessions } from '../../../../db/schema/index';
import {
  INITIAL_GREETING_IDS,
  initialGreetingWireBody,
} from '../../../../shared/test-fixtures/initial-greeting-save';

if (hasRealDb) {
  const target = new URL(realDbUrl);
  if (target.hostname !== '127.0.0.1' || target.port !== '55432') {
    throw new Error(
      `[session-initial-greeting] refusing real-DB fixtures against ${target.hostname}:${target.port}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

// The service imports the server's eager environment guard, as in dm-reply-reconcile.real-db.test.ts.
// The database job supplies the real URL separately.
process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const { SessionMessageService } = await importWithRealDb(
  () => import('../session/session-message-service.js'),
);

if (!hasRealDb) {
  console.warn(
    '[session-initial-greeting] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

/** The greeting exactly as the route hands it to the service: the client's wire body, mapped. */
const greeting = (
  sessionId: string,
  id: string,
): Parameters<typeof SessionMessageService.addMessages>[0][number] => {
  const body = initialGreetingWireBody(id) as {
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

describeWithDb('opening scene is saved once per session (#2379)', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  const userId = `initial-greeting-user-${process.pid}`;
  let campaignId = '';
  const sessionIds: string[] = [];

  const newSession = async (): Promise<string> => {
    const [{ id }] = await database
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    sessionIds.push(id);
    return id;
  };
  const rowsFor = (sessionId: string): Promise<(typeof dialogueHistory.$inferSelect)[]> =>
    database
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, sessionId))
      .orderBy(asc(dialogueHistory.createdAt));
  const turnCount = async (sessionId: string): Promise<number> =>
    (
      await database
        .select({ turnCount: gameSessions.turnCount })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId))
    )[0]?.turnCount ?? 0;

  beforeAll(async () => {
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('initial-greeting-campaign') })
      .returning({ id: campaigns.id });
  });

  afterAll(async () => {
    try {
      for (const id of sessionIds) {
        await database.delete(gameSessions).where(eq(gameSessions.id, id));
      }
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  test('run 15: two overlapping init calls for one new session persist exactly one greeting', async () => {
    const sessionId = await newSession();

    const [first, second] = await Promise.all([
      SessionMessageService.addMessages([greeting(sessionId, INITIAL_GREETING_IDS[0])], userId),
      SessionMessageService.addMessages([greeting(sessionId, INITIAL_GREETING_IDS[1])], userId),
    ]);

    const rows = await rowsFor(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.speakerType).toBe('dm');
    expect(rows[0]?.context).toEqual(expect.objectContaining({ initial_greeting: true }));
    // Both callers are told about the one greeting that exists, so neither sees an empty save.
    expect(first.map((row) => row.id)).toEqual([rows[0]?.id]);
    expect(second.map((row) => row.id)).toEqual([rows[0]?.id]);
    // The turn is counted once, so the client's `turn_count === 0` gate has flipped exactly once.
    expect(await turnCount(sessionId)).toBe(1);
  });

  test('a burst of overlapping saves still leaves one greeting', async () => {
    const sessionId = await newSession();

    await Promise.all(
      Array.from({ length: 6 }, () =>
        SessionMessageService.addMessages([greeting(sessionId, crypto.randomUUID())], userId),
      ),
    );

    expect(await rowsFor(sessionId)).toHaveLength(1);
    expect(await turnCount(sessionId)).toBe(1);
  });

  test('a late save after the greeting has landed loads the existing one instead of adding another', async () => {
    const sessionId = await newSession();
    const firstId = crypto.randomUUID();
    await SessionMessageService.addMessages([greeting(sessionId, firstId)], userId);

    const late = await SessionMessageService.addMessages(
      [greeting(sessionId, crypto.randomUUID())],
      userId,
    );

    expect(late.map((row) => row.id)).toEqual([firstId]);
    expect(await rowsFor(sessionId)).toHaveLength(1);
    expect(await turnCount(sessionId)).toBe(1);
  });

  test('other messages are untouched: a fallback line, the next turn, and another session own greeting', async () => {
    const sessionId = await newSession();
    const otherSessionId = await newSession();
    const fallbackId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const greetingId = crypto.randomUUID();
    const otherGreetingId = crypto.randomUUID();

    // The fallback the client saves when generation fails carries no greeting mark.
    await SessionMessageService.addMessages(
      [
        {
          id: fallbackId,
          sessionId,
          speakerType: 'dm',
          message: 'You find yourself standing at the threshold of adventure.',
          context: { isFallback: true },
        },
      ],
      userId,
    );
    await SessionMessageService.addMessages([greeting(sessionId, greetingId)], userId);
    await SessionMessageService.addMessages(
      [{ id: playerId, sessionId, speakerType: 'player', message: 'I take the map.' }],
      userId,
    );
    await SessionMessageService.addMessages([greeting(otherSessionId, otherGreetingId)], userId);

    expect((await rowsFor(sessionId)).map((row) => row.id).sort()).toEqual(
      [fallbackId, greetingId, playerId].sort(),
    );
    expect((await rowsFor(otherSessionId)).map((row) => row.id)).toEqual([otherGreetingId]);
    expect(await turnCount(sessionId)).toBe(3);
  });
});
