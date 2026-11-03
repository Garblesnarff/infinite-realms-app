/**
 * Plan-lookup failure through the REAL chronicles generate procedure + REAL
 * chronicle tables (#1344, round 2).
 *
 * Phase 1: with the plan query throwing, generate marks the row 'failed' and
 * throws INTERNAL_SERVER_ERROR 'Plan lookup unavailable' (tRPC has no 503).
 * Phase 2: with the query working again, the same upsert revives the failed
 * row — the procedure returns { chronicleId, generating: true } for the SAME
 * row id, which proves the revival without racing the background IIFE (the
 * IIFE's later provider failure is irrelevant to the assertion and harmless:
 * its catch updates zero rows after cleanup).
 *
 * What is real: chroniclesRouter, the drizzle client, and the chronicle
 * tables. What is injected: the tRPC ctx user, and lib/db.js — whose ONLY
 * consumer on this path is the strict plan resolver, so the wrapper below
 * sees exactly one query shape: when the flag is on it throws (the DB blip);
 * when off it reads the real users row through the drizzle client. The
 * seeded users row carries 'pro', so the retry's strict read matches the
 * ctx plan. Distinct user ids per test keep the 5-minute plan cache from
 * leaking between tests (a throw caches nothing).
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const USER_ID = testId('plan-fail-chronicle-user');

// Throw the plan query only while the flag is on; otherwise read the real row.
const planThrow = { enabled: false };
mock.module('../../../lib/db.js', () => ({
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    if (text.includes('SELECT plan FROM users')) {
      if (planThrow.enabled) throw new Error('plan lookup db unavailable (test injection)');
      const rows = await realDb().execute(
        sql`SELECT plan FROM users WHERE id = ${values[0] as string}`,
      );
      return rows as unknown[];
    }
    throw new Error(`[plan-lookup-failure] unexpected lib/db.js query: ${text}`);
  },
}));

const { chroniclesRouter } = await importWithRealDb(
  () => import('../../../trpc/routers/chronicles.js'),
);
const { campaigns, characters, gameSessions, sessionChronicles, users } = await importWithRealDb(
  () => import('../../../../../db/schema/index.js'),
);

if (!hasRealDb) {
  console.warn(
    '[plan-lookup-failure-chronicles] SKIPPED: set TEST_DATABASE_URL to a dedicated local Postgres to run this suite.',
  );
}

describeWithDb(
  'chronicles generate with a failing plan lookup marks failed, retry revives (#1344)',
  () => {
    const database = hasRealDb ? realDb() : (null as never);
    let campaignId = '';
    let characterId = '';
    let sessionId = '';

    beforeAll(async () => {
      if (!hasRealDb) return;
      await database
        .insert(users)
        .values({ id: USER_ID, email: 'plan-fail-chronicle@example.test', plan: 'pro' })
        .onConflictDoUpdate({ target: users.id, set: { plan: 'pro' } });
      const [campaign] = await database
        .insert(campaigns)
        .values({ userId: USER_ID, name: testId('plan-fail-chronicle-campaign') })
        .returning({ id: campaigns.id });
      campaignId = campaign.id;
      const [character] = await database
        .insert(characters)
        .values({ userId: USER_ID, campaignId, name: 'Plan Fail Hero', class: 'Fighter', level: 1 })
        .returning({ id: characters.id });
      characterId = character.id;
      const [session] = await database
        .insert(gameSessions)
        .values({ campaignId, characterId, sessionNumber: 1, status: 'active', turnCount: 0 })
        .returning({ id: gameSessions.id });
      sessionId = session.id;
    });

    afterAll(async () => {
      try {
        if (hasRealDb) {
          await database
            .delete(sessionChronicles)
            .where(eq(sessionChronicles.sessionId, sessionId))
            .catch(() => {});
          await database
            .delete(gameSessions)
            .where(eq(gameSessions.id, sessionId))
            .catch(() => {});
          if (characterId) {
            await database
              .delete(characters)
              .where(eq(characters.id, characterId))
              .catch(() => {});
          }
          if (campaignId) {
            await database
              .delete(campaigns)
              .where(eq(campaigns.id, campaignId))
              .catch(() => {});
          }
          await database
            .delete(users)
            .where(eq(users.id, USER_ID))
            .catch(() => {});
        }
      } finally {
        await closeRealDb();
      }
    });

    test('generate marks the row failed on a plan lookup error, and the same upsert revives it on retry', async () => {
      if (!hasRealDb) return;
      const caller = chroniclesRouter.createCaller({
        user: { userId: USER_ID, plan: 'pro' },
        db: database,
      } as never);

      // Phase 1: the blip. The row goes to 'failed' and the caller gets an error.
      planThrow.enabled = true;
      let caught: { code?: string; message?: string } | undefined;
      try {
        await caller.generate({ sessionId });
      } catch (err) {
        caught = err as { code?: string; message?: string };
      } finally {
        planThrow.enabled = false;
      }
      expect(caught).toBeDefined();
      expect(caught?.code).toBe('INTERNAL_SERVER_ERROR');
      expect(caught?.message).toBe('Plan lookup unavailable');

      const failedRows = await database
        .select()
        .from(sessionChronicles)
        .where(eq(sessionChronicles.sessionId, sessionId));
      expect(failedRows).toHaveLength(1);
      expect(failedRows[0].status).toBe('failed');
      expect(failedRows[0].errorMessage).toContain('plan lookup db unavailable');
      const failedRowId = failedRows[0].id;

      // Phase 2: the retry. The same upsert revives the SAME row id — it does not
      // insert a second row, and it does not throw. (The background IIFE may
      // later fail the row again without a provider; that is irrelevant here:
      // the return below already proves the revival happened.)
      const ret = await caller.generate({ sessionId });
      expect(ret).toEqual({ chronicleId: failedRowId, generating: true });
    });
  },
);
