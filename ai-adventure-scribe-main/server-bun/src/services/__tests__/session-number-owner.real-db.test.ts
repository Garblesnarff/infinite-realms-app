/**
 * One session number for the sessions list and the chronicle (#1592), against a real Postgres.
 *
 * The campaign holds 12 sessions of user A and 3 of user B, created at interleaved times. The
 * number a session shows is its place among its OWNER's sessions in that campaign, by created_at.
 * It must be the same number on the list card (GET /v1/sessions, first page of 10) and on the
 * chronicle eyebrow (chronicles.getBySessionId).
 *
 * On main, the list ranks only its loaded page (so the newest session on page 1 reads 10), and the
 * chronicle ranks every session in the campaign with no owner filter (so user A's newest reads 14
 * here, counting user B's sessions). Both assertions fail there.
 *
 * What is real: the sessions route, the chronicles router, the drizzle client, and the tables.
 * What is faked: only authentication, which maps a bearer token to a user id.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characters,
  gameSessions,
  sessionChronicles,
} from '../../../../db/schema/index';

process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';

const USER_A = testId('rank-owner-a');
const USER_B = testId('rank-owner-b');

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '';
    return token === USER_A || token === USER_B
      ? { user: { userId: token, email: 'rank@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { sessionsRoutes } = await importWithRealDb(() => import('../../routes/v1/sessions.js'));
const { chroniclesRouter } = await importWithRealDb(
  () => import('../../trpc/routers/chronicles.js'),
);

const MINUTE = 60_000;
const BASE = Date.UTC(2026, 10, 1, 12, 0, 0);

const A_COUNT = 12;
/** User B's sessions fall between user A's, so counting them would move A's numbers. */
const B_OFFSETS_MINUTES = [5.5, 8.5, 13.5];

let campaignId = '';
let characterAId = '';
let characterBId = '';
const sessionIdsA: string[] = [];
const sessionIdsB: string[] = [];

describeWithDb(
  'session number: one owner-scoped rank for the list and the chronicle (#1592)',
  () => {
    beforeAll(async () => {
      const db = realDb();

      [{ id: campaignId }] = await db
        .insert(campaigns)
        .values({ userId: USER_A, name: testId('rank-campaign') })
        .returning({ id: campaigns.id });

      [{ id: characterAId }] = await db
        .insert(characters)
        .values({
          userId: USER_A,
          campaignId,
          name: testId('rank-hero-a'),
          level: 1,
          class: 'Fighter',
        })
        .returning({ id: characters.id });

      [{ id: characterBId }] = await db
        .insert(characters)
        .values({
          userId: USER_B,
          campaignId,
          name: testId('rank-hero-b'),
          level: 1,
          class: 'Rogue',
        })
        .returning({ id: characters.id });

      for (let index = 0; index < A_COUNT; index += 1) {
        const [{ id }] = await db
          .insert(gameSessions)
          .values({
            campaignId,
            characterId: characterAId,
            sessionNumber: 1,
            status: 'completed',
            createdAt: new Date(BASE + index * MINUTE),
          })
          .returning({ id: gameSessions.id });
        sessionIdsA.push(id);
      }

      for (const offset of B_OFFSETS_MINUTES) {
        const [{ id }] = await db
          .insert(gameSessions)
          .values({
            campaignId,
            characterId: characterBId,
            sessionNumber: 1,
            status: 'completed',
            createdAt: new Date(BASE + offset * MINUTE),
          })
          .returning({ id: gameSessions.id });
        sessionIdsB.push(id);
      }
    });

    afterAll(async () => {
      const db = realDb();
      if (sessionIdsA.length + sessionIdsB.length > 0) {
        await db
          .delete(sessionChronicles)
          .where(inArray(sessionChronicles.sessionId, [...sessionIdsA, ...sessionIdsB]));
        await db.delete(gameSessions).where(eq(gameSessions.campaignId, campaignId));
      }
      if (characterAId) await db.delete(characters).where(eq(characters.id, characterAId));
      if (characterBId) await db.delete(characters).where(eq(characters.id, characterBId));
      if (campaignId) await db.delete(campaigns).where(eq(campaigns.id, campaignId));
      await closeRealDb();
    });

    test('the list card shows the same owner-scoped number on every page, not a page-local rank', async () => {
      const app = new Elysia().use(sessionsRoutes);
      const response = await app.handle(
        new Request(`http://localhost/v1/sessions?campaign_id=${campaignId}&limit=10&offset=0`, {
          headers: { authorization: `Bearer ${USER_A}` },
        }),
      );
      expect(response.status).toBe(200);
      const rows = (await response.json()) as Array<{ id: string; display_session_number: number }>;

      // Page 1 of 10 (newest first) holds some of A's sessions. Each shows its place among ALL of
      // A's sessions, not its place on this page: A's session 11 (created last) reads 12, and A's
      // session 6 reads 6 even though B's sessions sit among them on the page.
      expect(rows).toHaveLength(10);
      const onPage = (index: number): { display_session_number: number } | undefined =>
        rows.find((row) => row.id === sessionIdsA[index]);
      expect(onPage(A_COUNT - 1)?.display_session_number).toBe(12);
      expect(onPage(5)?.display_session_number).toBe(6);
    });

    test('the chronicle eyebrow shows the same number the list card shows for that session', async () => {
      const db = realDb();
      const newestA = sessionIdsA[A_COUNT - 1];
      await db.insert(sessionChronicles).values({
        sessionId: newestA,
        userId: USER_A,
        status: 'ready',
        chapterTitle: 'The Newest Chapter',
        chronicleText: 'A test chronicle.',
      });

      const caller = chroniclesRouter.createCaller({
        db,
        user: { userId: USER_A, plan: 'free' },
      } as never);
      const chronicle = await caller.getBySessionId({ sessionId: newestA });

      expect(chronicle).not.toBeNull();
      expect(chronicle?.sessionNumber).toBe(12);
    });

    test("another owner's sessions in the same campaign do not change user A's numbers", async () => {
      const app = new Elysia().use(sessionsRoutes);
      const response = await app.handle(
        new Request(`http://localhost/v1/sessions?campaign_id=${campaignId}&limit=50&offset=0`, {
          headers: { authorization: `Bearer ${USER_B}` },
        }),
      );
      const rows = (await response.json()) as Array<{ id: string; display_session_number: number }>;

      // User B sees only B's sessions in the campaign, numbered 1..3 among themselves.
      expect(rows).toHaveLength(B_OFFSETS_MINUTES.length);
      const newestB = rows.find((row) => row.id === sessionIdsB[B_OFFSETS_MINUTES.length - 1]);
      expect(newestB?.display_session_number).toBe(3);
    });
  },
);
