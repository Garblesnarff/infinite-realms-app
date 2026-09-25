/* eslint-disable max-lines -- one fixture covers the write, the reconcile, retries and ai_usage. */
/**
 * #2218: the server's provisional DM row and the client's own save of that turn must end as ONE
 * dialogue_history row carrying the client's final text, with the session's turn counted once.
 *
 * This runs against real PostgreSQL on purpose. The reconcile is an UPDATE guarded by a JSONB
 * predicate (`context->>'provisional' = 'true'`) followed by an insert that must conflict on the
 * same primary key; the unit suite's db mock cannot execute either, and a mocked "update was
 * called" would pass against SQL that never matches a row. It refuses every target except the
 * dedicated local/CI Postgres because it writes fixtures.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, asc, eq, inArray } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  dialogueHistory,
  gameSessions,
  type DialogueHistory,
} from '../../../../db/schema/index';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';

export function assertSafeDmReplyDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[dm-reply-reconcile] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }
  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (
    !isPostgres ||
    parsed.hostname !== DEDICATED_REAL_DB_HOST ||
    parsed.port !== DEDICATED_REAL_DB_PORT
  ) {
    const target = parsed.hostname ? `${parsed.hostname}:${parsed.port || '(default)'}` : 'unknown';
    throw new Error(
      `[dm-reply-reconcile] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeDmReplyDatabase(realDbUrl);

// AIUsageService's postgres.js client imports the server's eager environment guard, as in
// combat-entry-transcript.real-db.test.ts. The database job supplies the real URL separately.
process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const { SessionMessageService } = await importWithRealDb(
  () => import('../session/session-message-service.js'),
);
const { dmRowExistsSince, persistGeneratedDmReply, provisionalDmText } = await importWithRealDb(
  () => import('../dm/dm-reply-persistence.js'),
);
const { AIUsageService } = await importWithRealDb(() => import('../ai-usage-service.js'));
const { sql } = await importWithRealDb(() => import('../../lib/db.js'));

if (!hasRealDb) {
  console.warn(
    '[dm-reply-reconcile] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

test('refuses a non-dedicated database target before fixture writes', () => {
  expect(() => assertSafeDmReplyDatabase('postgres://prod.example.test:5432/postgres')).toThrow(
    'refusing real-DB fixtures',
  );
});

const explorationEnvelope = {
  text: 'The torchlight catches on wet stone. Forty steps down, the stair ends in black water.',
  options: ['A. **Test the water**, lower the torch.', 'B. **Go back up**, find another way.'],
  roll_requests: [],
  combat_transition: 'none',
  combatants: [],
  combat_actions: [],
};

describeWithDb('DM reply: server provisional row + client save = one row (#2218)', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  const userId = `dm-reply-reconcile-user-${process.pid}`;
  let campaignId = '';
  let sessionId = '';

  const rowsFor = async (ids: string[]): Promise<DialogueHistory[]> =>
    database
      .select()
      .from(dialogueHistory)
      .where(and(eq(dialogueHistory.sessionId, sessionId), inArray(dialogueHistory.id, ids)))
      .orderBy(asc(dialogueHistory.createdAt));
  const turnCount = async (): Promise<number> =>
    (
      await database
        .select({ turnCount: gameSessions.turnCount })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId))
    )[0]?.turnCount ?? 0;

  beforeAll(async () => {
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('dm-reply-campaign') })
      .returning({ id: campaigns.id });
    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
  });

  afterAll(async () => {
    try {
      if (sessionId) await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await sql.end({ timeout: 5 });
      await closeRealDb();
    }
  });

  test('Aug 26: the player speaks, the model answers, the client never saves — the DM row exists', async () => {
    const playerId = crypto.randomUUID();
    const dmId = crypto.randomUUID();
    await SessionMessageService.addMessages(
      [{ id: playerId, sessionId, speakerType: 'player', message: 'I look down the stairwell.' }],
      userId,
    );
    const generatedAt = new Date(Date.now() - 1000);

    const result = await persistGeneratedDmReply({
      userId,
      sessionId,
      messageId: dmId,
      envelope: explorationEnvelope,
    });

    expect(result).toEqual({ persisted: true });
    const rows = await rowsFor([playerId, dmId]);
    expect(rows.map((row) => [row.speakerType, row.id])).toEqual([
      ['player', playerId],
      ['dm', dmId],
    ]);
    expect(rows[1]?.message).toBe(provisionalDmText(explorationEnvelope));
    expect(rows[1]?.context).toEqual(expect.objectContaining({ provisional: true }));
    // The watchdog's own query sees it, so a persisted turn never reports as lost.
    expect(await dmRowExistsSince(sessionId, generatedAt)).toBe(true);
  });

  test('the client save of the same id replaces the provisional row in place: one row, final text, one turn', async () => {
    const dmId = crypto.randomUUID();
    await persistGeneratedDmReply({
      userId,
      sessionId,
      messageId: dmId,
      envelope: explorationEnvelope,
    });
    const afterServerWrite = await turnCount();
    // The client's clock, which orders the player's row; a little behind the server's here.
    const clientTimestamp = new Date(Date.now() - 5_000);
    const finalText = `${explorationEnvelope.text}\n\nThe water ripples, though nothing touched it.\n\nA. **Test the water**, lower the torch.`;

    const saved = await SessionMessageService.addMessages(
      [
        {
          id: dmId,
          sessionId,
          speakerType: 'dm',
          message: finalText,
          context: { intent: 'response', emotion: 'neutral', narration_segments: [] },
          timestamp: clientTimestamp,
        },
      ],
      userId,
    );

    expect(saved.map((row) => row.id)).toEqual([dmId]);
    const rows = await rowsFor([dmId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe(finalText);
    expect(rows[0]?.timestamp?.toISOString()).toBe(clientTimestamp.toISOString());
    expect(rows[0]?.context).toEqual({
      intent: 'response',
      emotion: 'neutral',
      narration_segments: [],
    });
    // The server's insert counted the turn; replacing it in place must not count it again.
    expect(await turnCount()).toBe(afterServerWrite);
  });

  test('once the client has saved, a later duplicate is a no-op retry, not a replacement', async () => {
    const dmId = crypto.randomUUID();
    await persistGeneratedDmReply({
      userId,
      sessionId,
      messageId: dmId,
      envelope: explorationEnvelope,
    });
    await SessionMessageService.addMessages(
      [{ id: dmId, sessionId, speakerType: 'dm', message: 'Final authoritative text.' }],
      userId,
    );
    const before = await turnCount();

    await SessionMessageService.addMessages(
      [{ id: dmId, sessionId, speakerType: 'dm', message: 'A stale duplicate.' }],
      userId,
    );

    const rows = await rowsFor([dmId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe('Final authoritative text.');
    expect(await turnCount()).toBe(before);
  });

  test('a client save with no server row still inserts exactly once (roll and combat turns)', async () => {
    const dmId = crypto.randomUUID();
    const before = await turnCount();

    await SessionMessageService.addMessages(
      [{ id: dmId, sessionId, speakerType: 'dm', message: 'The engine resolved the strike.' }],
      userId,
    );

    expect(await rowsFor([dmId])).toHaveLength(1);
    expect(await turnCount()).toBe(before + 1);
  });

  test('ai_usage carries the session, so "did the DM reply?" is one query (#2184 friction)', async () => {
    const dmId = crypto.randomUUID();
    await AIUsageService.recordProviderUsage({
      userId,
      plan: 'free',
      type: 'llm',
      provider: 'openrouter',
      model: 'mistralai/mistral-small-creative',
      inputTokens: 5210,
      outputTokens: 731,
      sessionId,
    });
    await persistGeneratedDmReply({
      userId,
      sessionId,
      messageId: dmId,
      envelope: explorationEnvelope,
    });

    const [answer] = await sql<{ output_tokens: number; dm_reply_saved: boolean }[]>`
      SELECT u.output_tokens,
             EXISTS (
               SELECT 1 FROM dialogue_history d
               WHERE d.session_id::text = u.session_id
                 AND d.speaker_type = 'dm'
                 AND d.created_at >= u.created_at
             ) AS dm_reply_saved
      FROM ai_usage u
      WHERE u.session_id = ${sessionId} AND u.output_tokens = 731
      ORDER BY u.created_at DESC
      LIMIT 1
    `;

    expect(answer).toEqual({ output_tokens: 731, dm_reply_saved: true });
    await sql`DELETE FROM ai_usage WHERE session_id = ${sessionId}`;
  });

  test('another user cannot write a provisional row into this session', async () => {
    const dmId = crypto.randomUUID();

    const result = await persistGeneratedDmReply({
      userId: `${userId}-intruder`,
      sessionId,
      messageId: dmId,
      envelope: explorationEnvelope,
    });

    expect(result).toEqual({ persisted: false, reason: 'write_failed' });
    expect(await rowsFor([dmId])).toHaveLength(0);
  });
});
