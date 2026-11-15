/* eslint-disable max-lines -- the fixture, the owner-scope cases and the concurrency case share one database. */
/**
 * #1444: the session-load sweep of held DM reply records, against real PostgreSQL.
 *
 * The unit suite injects every database call. This suite does not: the owner-scoped listing, the
 * conditional `held` move and the cancel all run as SQL against the dedicated Postgres, so a
 * predicate that matches nothing (or the wrong owner's rows) fails here. It writes fixtures, so it
 * refuses every target except the dedicated local/CI Postgres at 127.0.0.1:55432.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';

import {
  campaigns,
  characters,
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

import type { DmReplyRecord } from '../dm-reply-persistence.js';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';

export function assertSafeExpiryDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[dm-reply-expiry] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
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
      `[dm-reply-expiry] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeExpiryDatabase(realDbUrl);

// The server's eager environment guard runs when the db client is first loaded (as in the sibling
// real-DB suites). The database job supplies the real URL; these only satisfy the guard.
process.env.PORT ??= '8894';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const { expireStaleHeldReplies, DM_REPLY_RECORD_EXPIRY_MS } = await importWithRealDb(
  () => import('../dm-reply-persistence.js'),
);

const RUN = randomUUID().slice(0, 8);
const OWNER = `expiry-owner-${RUN}`;
const OTHER = `expiry-other-${RUN}`;
const NOW = new Date();
const STALE = new Date(NOW.getTime() - DM_REPLY_RECORD_EXPIRY_MS - 60 * 60_000);
const FRESH = new Date(NOW.getTime() - 60_000);

const noFight = {
  confirmedSince: async () => false,
  pendingEntryExpired: async () => false,
  declinedActorKeys: async (): Promise<string[]> => [],
};

const ids = {
  campaignOwned: randomUUID(),
  campaignOther: randomUUID(),
  characterOwned: randomUUID(),
  sessionCampaign: randomUUID(),
  sessionCharacter: randomUUID(),
  sessionOther: randomUUID(),
  sessionConcurrent: randomUUID(),
  sessionPublish: randomUUID(),
  staleByCampaign: randomUUID(),
  freshByCampaign: randomUUID(),
  staleByCharacter: randomUUID(),
  staleOtherSession: randomUUID(),
  staleOtherUser: randomUUID(),
  readyByCampaign: randomUUID(),
  staleConcurrent: randomUUID(),
  stalePublish: randomUUID(),
};

function fixtureRecord(
  id: string,
  sessionId: string,
  userId: string,
  createdAt: Date,
  overrides: { state?: string; text?: string } = {},
): typeof dmReplyRecords.$inferInsert {
  return {
    id,
    sessionId,
    userId,
    state: overrides.state ?? 'held',
    text: overrides.text ?? 'The cellar door creaks open onto cold stone.',
    envelope: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describeWithDb('#1444 held reply expiry against real Postgres', () => {
  beforeAll(async () => {
    const db = realDb();
    await db.insert(campaigns).values([
      { id: ids.campaignOwned, userId: OWNER, name: `expiry campaign ${RUN}` },
      { id: ids.campaignOther, userId: OTHER, name: `expiry other campaign ${RUN}` },
    ]);
    await db
      .insert(characters)
      .values({ id: ids.characterOwned, userId: OWNER, name: `expiry character ${RUN}` });
    await db.insert(gameSessions).values([
      { id: ids.sessionCampaign, campaignId: ids.campaignOwned },
      { id: ids.sessionCharacter, characterId: ids.characterOwned },
      { id: ids.sessionOther, campaignId: ids.campaignOther },
      { id: ids.sessionConcurrent, campaignId: ids.campaignOwned },
      { id: ids.sessionPublish, campaignId: ids.campaignOwned },
    ]);
    await db.insert(dmReplyRecords).values([
      fixtureRecord(ids.staleByCampaign, ids.sessionCampaign, OWNER, STALE),
      fixtureRecord(ids.freshByCampaign, ids.sessionCampaign, OWNER, FRESH),
      fixtureRecord(ids.staleByCharacter, ids.sessionCharacter, OWNER, STALE),
      // Owned by OWNER as a record, but its session belongs to OTHER: never touched by OWNER.
      fixtureRecord(ids.staleOtherSession, ids.sessionOther, OWNER, STALE),
      // A session OWNER holds, but the record was generated for OTHER: never touched by OWNER.
      fixtureRecord(ids.staleOtherUser, ids.sessionCampaign, OTHER, STALE),
      fixtureRecord(ids.readyByCampaign, ids.sessionCampaign, OWNER, STALE, { state: 'ready' }),
      fixtureRecord(ids.staleConcurrent, ids.sessionConcurrent, OWNER, STALE),
      fixtureRecord(ids.stalePublish, ids.sessionPublish, OWNER, STALE),
    ]);
  });

  afterAll(async () => {
    const db = realDb();
    await db
      .delete(dmReplyRecords)
      .where(
        inArray(dmReplyRecords.sessionId, [
          ids.sessionCampaign,
          ids.sessionCharacter,
          ids.sessionOther,
          ids.sessionConcurrent,
          ids.sessionPublish,
        ]),
      );
    await db
      .delete(gameSessions)
      .where(
        inArray(gameSessions.id, [
          ids.sessionCampaign,
          ids.sessionCharacter,
          ids.sessionOther,
          ids.sessionConcurrent,
          ids.sessionPublish,
        ]),
      );
    await db.delete(characters).where(inArray(characters.id, [ids.characterOwned]));
    await db.delete(campaigns).where(inArray(campaigns.id, [ids.campaignOwned, ids.campaignOther]));
    await closeRealDb();
  });

  const stateOf = async (id: string): Promise<string | undefined> => {
    const [row] = await realDb()
      .select({ state: dmReplyRecords.state })
      .from(dmReplyRecords)
      .where(inArray(dmReplyRecords.id, [id]));
    return row?.state;
  };

  test('a stale record of the owner campaign session is cancelled; a stale ready record is published (#1502); fresh and other-owner records are not', async () => {
    const settled = await expireStaleHeldReplies(
      { sessionId: ids.sessionCampaign, userId: OWNER, now: NOW },
      { heldReplyDeps: noFight, writeRow: async () => {} },
    );
    expect(await stateOf(ids.staleByCampaign)).toBe('cancelled');
    expect(await stateOf(ids.freshByCampaign)).toBe('held');
    // #1502: the same sweep now retries a stale ready record; its write succeeds here, so it persists.
    expect(await stateOf(ids.readyByCampaign)).toBe('persisted');
    expect(await stateOf(ids.staleOtherUser)).toBe('held');
    expect(settled).toBeGreaterThanOrEqual(1);
  });

  test('a session owned through its character settles the same way', async () => {
    const settled = await expireStaleHeldReplies(
      { sessionId: ids.sessionCharacter, userId: OWNER, now: NOW },
      { heldReplyDeps: noFight, writeRow: async () => {} },
    );
    expect(settled).toBe(1);
    expect(await stateOf(ids.staleByCharacter)).toBe('cancelled');
  });

  test('a session owned by someone else is never touched, whatever the record says', async () => {
    const settled = await expireStaleHeldReplies(
      { sessionId: ids.sessionOther, userId: OWNER, now: NOW },
      { heldReplyDeps: noFight, writeRow: async () => {} },
    );
    expect(settled).toBe(0);
    expect(await stateOf(ids.staleOtherSession)).toBe('held');
  });

  test('a record the listing hands over is still refused by the owner-scoped move when another owner holds it', async () => {
    // The listing is injected to prove the UPDATE's own owner scope: a stale record of another
    // owner's session, and a stale record generated for another user, must both be refused there.
    const forged = (id: string, sessionId: string, userId: string): DmReplyRecord => ({
      id,
      sessionId,
      userId,
      state: 'held',
      text: 'x',
      envelope: null,
      createdAt: STALE,
    });
    const settled = await expireStaleHeldReplies(
      { sessionId: ids.sessionOther, userId: OWNER, now: NOW },
      {
        heldReplyDeps: noFight,
        writeRow: async () => {},
        listStale: async () => [forged(ids.staleOtherSession, ids.sessionOther, OWNER)],
      },
    );
    expect(settled).toBe(0);
    expect(await stateOf(ids.staleOtherSession)).toBe('held');

    const settledByUser = await expireStaleHeldReplies(
      { sessionId: ids.sessionCampaign, userId: OWNER, now: NOW },
      {
        heldReplyDeps: noFight,
        writeRow: async () => {},
        listStale: async () => [forged(ids.staleOtherUser, ids.sessionCampaign, OWNER)],
      },
    );
    expect(settledByUser).toBe(0);
    expect(await stateOf(ids.staleOtherUser)).toBe('held');
  });

  test('the move is conditional on held and on age: a fresh or ready record is refused by the UPDATE', async () => {
    const readyBefore = await stateOf(ids.readyByCampaign);
    const settled = await expireStaleHeldReplies(
      { sessionId: ids.sessionCampaign, userId: OWNER, now: NOW },
      {
        heldReplyDeps: noFight,
        writeRow: async () => {},
        listStale: async () => [
          {
            id: ids.freshByCampaign,
            sessionId: ids.sessionCampaign,
            userId: OWNER,
            state: 'held',
            text: 'x',
            envelope: null,
            createdAt: FRESH,
          },
          {
            id: ids.readyByCampaign,
            sessionId: ids.sessionCampaign,
            userId: OWNER,
            state: 'held',
            text: 'x',
            envelope: null,
            createdAt: STALE,
          },
        ],
      },
    );
    expect(settled).toBe(0);
    expect(await stateOf(ids.freshByCampaign)).toBe('held');
    // Unchanged by this call: the held UPDATE refuses a row that is no longer held.
    expect(await stateOf(ids.readyByCampaign)).toBe(readyBefore);
  });

  test('two concurrent loads cancel one stale record once', async () => {
    const load = (): Promise<number> =>
      expireStaleHeldReplies(
        { sessionId: ids.sessionConcurrent, userId: OWNER, now: NOW },
        { heldReplyDeps: noFight, writeRow: async () => {} },
      );
    const results = await Promise.all([load(), load()]);
    // Each load lists the same stale row, but the conditional UPDATE moves it once.
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(await stateOf(ids.staleConcurrent)).toBe('cancelled');
  });

  test('a confirmed fight publishes the stale record: it is written once and ends persisted', async () => {
    const written: DmReplyRecord[] = [];
    const settled = await expireStaleHeldReplies(
      { sessionId: ids.sessionPublish, userId: OWNER, now: NOW },
      {
        heldReplyDeps: { ...noFight, confirmedSince: async () => true },
        writeRow: async (record) => {
          written.push(record);
        },
      },
    );
    expect(settled).toBe(1);
    expect(written.map((r) => r.id)).toEqual([ids.stalePublish]);
    expect(await stateOf(ids.stalePublish)).toBe('persisted');
  });
});
