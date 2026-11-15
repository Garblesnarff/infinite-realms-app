/**
 * #1502: the session-load retry of ready DM reply records, against real PostgreSQL.
 *
 * Nothing here is mocked. The owner-scoped listing, the conditional claim, the transcript write
 * through SessionMessageService and the guarded transition all run as SQL against the dedicated
 * Postgres. It writes fixtures, so it refuses every target except 127.0.0.1:55432.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  campaigns,
  dialogueHistory,
  dmReplyRecords,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
} from '../../__tests__/fixtures/real-db.js';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';

export function assertSafeReadyRetryDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[dm-reply-ready-retry] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
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
      `[dm-reply-ready-retry] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeReadyRetryDatabase(realDbUrl);

// The server's eager environment guard runs when the db client is first loaded (as in the sibling
// real-DB suites). The database job supplies the real URL; these only satisfy the guard.
process.env.PORT ??= '8895';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const { expireStaleHeldReplies, DM_REPLY_PUBLISH_RETRY_GRACE_MS } = await importWithRealDb(
  () => import('../dm-reply-persistence.js'),
);

const RUN = randomUUID().slice(0, 8);
const OWNER = `ready-retry-owner-${RUN}`;
const OTHER = `ready-retry-other-${RUN}`;
const NOW = new Date();
const STALE = new Date(NOW.getTime() - DM_REPLY_PUBLISH_RETRY_GRACE_MS - 60 * 60_000);
const FRESH = new Date(NOW.getTime() - 10_000);
const CLIENT_TEXT = 'The client saved its own final text.';

const ids = {
  campaignOwned: randomUUID(),
  campaignOther: randomUUID(),
  sessionMissingRow: randomUUID(),
  sessionRowExists: randomUUID(),
  sessionForeign: randomUUID(),
  recordMissingRow: randomUUID(),
  recordRowExists: randomUUID(),
  recordFresh: randomUUID(),
  recordForeign: randomUUID(),
};

describeWithDb('#1502 ready reply retry against real Postgres', () => {
  beforeAll(async () => {
    const db = realDb();
    await db.insert(campaigns).values([
      { id: ids.campaignOwned, userId: OWNER, name: `ready-retry campaign ${RUN}` },
      { id: ids.campaignOther, userId: OTHER, name: `ready-retry other campaign ${RUN}` },
    ]);
    await db.insert(gameSessions).values([
      { id: ids.sessionMissingRow, campaignId: ids.campaignOwned },
      { id: ids.sessionRowExists, campaignId: ids.campaignOwned },
      { id: ids.sessionForeign, campaignId: ids.campaignOther },
    ]);
    // A row already stored under the reserved id, carrying the client's final text (not provisional).
    await db.insert(dialogueHistory).values({
      id: ids.recordRowExists,
      sessionId: ids.sessionRowExists,
      speakerType: 'dm',
      message: CLIENT_TEXT,
      context: {},
      timestamp: STALE,
    });
    const record = (
      id: string,
      sessionId: string,
      userId: string,
      updatedAt: Date,
    ): typeof dmReplyRecords.$inferInsert => ({
      id,
      sessionId,
      userId,
      state: 'ready',
      text: 'The server copy of the reply.',
      envelope: null,
      createdAt: updatedAt,
      updatedAt,
    });
    await db
      .insert(dmReplyRecords)
      .values([
        record(ids.recordMissingRow, ids.sessionMissingRow, OWNER, STALE),
        record(ids.recordRowExists, ids.sessionRowExists, OWNER, STALE),
        record(ids.recordFresh, ids.sessionMissingRow, OWNER, FRESH),
        record(ids.recordForeign, ids.sessionForeign, OTHER, STALE),
      ]);
  });

  afterAll(async () => {
    const db = realDb();
    await db.delete(dmReplyRecords).where(eq(dmReplyRecords.sessionId, ids.sessionMissingRow));
    await db.delete(dmReplyRecords).where(eq(dmReplyRecords.sessionId, ids.sessionRowExists));
    await db.delete(dmReplyRecords).where(eq(dmReplyRecords.sessionId, ids.sessionForeign));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, ids.sessionMissingRow));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, ids.sessionRowExists));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, ids.sessionForeign));
    await db.delete(gameSessions).where(eq(gameSessions.id, ids.sessionMissingRow));
    await db.delete(gameSessions).where(eq(gameSessions.id, ids.sessionRowExists));
    await db.delete(gameSessions).where(eq(gameSessions.id, ids.sessionForeign));
    await db.delete(campaigns).where(eq(campaigns.id, ids.campaignOwned));
    await db.delete(campaigns).where(eq(campaigns.id, ids.campaignOther));
    await closeRealDb();
  });

  test('ready + missing row: two concurrent loads leave one row and the record persisted', async () => {
    const db = realDb();
    await Promise.all([
      expireStaleHeldReplies({ sessionId: ids.sessionMissingRow, userId: OWNER }),
      expireStaleHeldReplies({ sessionId: ids.sessionMissingRow, userId: OWNER }),
    ]);
    const rows = await db
      .select({ id: dialogueHistory.id })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, ids.recordMissingRow));
    const [record] = await db
      .select({ state: dmReplyRecords.state })
      .from(dmReplyRecords)
      .where(eq(dmReplyRecords.id, ids.recordMissingRow));
    expect(rows).toHaveLength(1);
    expect(record?.state).toBe('persisted');
  });

  test('ready + row already there: the record persists and the row stays one, with the client text', async () => {
    const db = realDb();
    await expireStaleHeldReplies({ sessionId: ids.sessionRowExists, userId: OWNER });
    const rows = await db
      .select({ message: dialogueHistory.message })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, ids.recordRowExists));
    const [record] = await db
      .select({ state: dmReplyRecords.state })
      .from(dmReplyRecords)
      .where(eq(dmReplyRecords.id, ids.recordRowExists));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe(CLIENT_TEXT);
    expect(record?.state).toBe('persisted');
  });

  test('a record inside the grace is not touched', async () => {
    const db = realDb();
    await expireStaleHeldReplies({ sessionId: ids.sessionMissingRow, userId: OWNER });
    const [record] = await db
      .select({ state: dmReplyRecords.state })
      .from(dmReplyRecords)
      .where(eq(dmReplyRecords.id, ids.recordFresh));
    const rows = await db
      .select({ id: dialogueHistory.id })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, ids.recordFresh));
    expect(record?.state).toBe('ready');
    expect(rows).toHaveLength(0);
  });

  test('foreign session: a load by another owner leaves its ready record untouched', async () => {
    const db = realDb();
    await expireStaleHeldReplies({ sessionId: ids.sessionForeign, userId: OWNER });
    const [record] = await db
      .select({ state: dmReplyRecords.state })
      .from(dmReplyRecords)
      .where(eq(dmReplyRecords.id, ids.recordForeign));
    const rows = await db
      .select({ id: dialogueHistory.id })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, ids.sessionForeign));
    expect(record?.state).toBe('ready');
    expect(rows).toHaveLength(0);
  });
});
