/**
 * Plan-lookup failure through the REAL session-complete route + REAL chronicle
 * tables (#1344, round 2).
 *
 * The session IS completed by the time the plan lookup runs, so a lookup error
 * cannot 503 the response: the route must record a failed chronicle row and
 * still return 200. This test proves that against real persistence.
 *
 * What is real: sessionsRoutes, SessionService, persistChronicleFailure, the
 * drizzle client, and the chronicle tables. What is injected: auth (a stub
 * user), and lib/db.js — whose ONLY consumer on this path is the strict plan
 * resolver, so the wrapper below sees exactly one query shape: when the flag is
 * on it throws (the DB blip); when off it reads the real users row through the
 * drizzle client. Distinct user ids per test keep the 5-minute plan cache from
 * leaking between tests (a throw caches nothing).
 */
import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const USER_ID = testId('plan-fail-session-user');

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.split(' ').at(-1) ?? '';
    return token === USER_ID
      ? {
          user: { userId: USER_ID, email: 'plan-fail-session@example.test', plan: 'pro' },
          error: null,
        }
      : { user: null, error: 'Unauthorized' };
  },
}));

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

const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { sessionsRoutes } = await importWithRealDb(() => import('../sessions.js'));
const { campaigns, characters, characterStats, gameSessions, sessionChronicles } =
  await importWithRealDb(() => import('../../../../../db/schema/index.js'));

if (!hasRealDb) {
  console.warn(
    '[plan-lookup-failure-sessions] SKIPPED: set TEST_DATABASE_URL to a dedicated local Postgres to run this suite.',
  );
}

describeWithDb(
  'session complete with a failing plan lookup leaves a failed chronicle row (#1344)',
  () => {
    const database = hasRealDb ? realDb() : (null as never);
    let campaignId = '';
    let characterId = '';
    let sessionId = '';

    const app = hasRealDb ? createRequestPipelineApp().use(sessionsRoutes) : null;

    beforeAll(async () => {
      if (!hasRealDb) return;
      const [campaign] = await database
        .insert(campaigns)
        .values({ userId: USER_ID, name: testId('plan-fail-session-campaign') })
        .returning({ id: campaigns.id });
      campaignId = campaign.id;
      const [character] = await database
        .insert(characters)
        .values({ userId: USER_ID, campaignId, name: 'Plan Fail Hero', class: 'Fighter', level: 1 })
        .returning({ id: characters.id });
      characterId = character.id;
      await database.insert(characterStats).values({
        characterId,
        armorClass: 16,
        maxHitPoints: 20,
        currentHitPoints: 20,
        strength: 16,
      });
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
              .delete(characterStats)
              .where(eq(characterStats.characterId, characterId))
              .catch(() => {});
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
        }
      } finally {
        await closeRealDb();
      }
    });

    test('completing a session with a failing plan lookup still returns 200 and leaves a failed chronicle row', async () => {
      if (!hasRealDb) return;
      planThrow.enabled = true;
      try {
        const response = await (
          app as unknown as { handle: (r: Request) => Promise<Response> }
        ).handle(
          new Request(`http://localhost/v1/sessions/${sessionId}/complete`, {
            method: 'POST',
            headers: { authorization: `Bearer ${USER_ID}`, 'content-type': 'application/json' },
            body: JSON.stringify({ summary: 'Finished despite the blip' }),
          }),
        );
        expect(response.status).toBe(200);
        const json = (await response.json()) as Record<string, unknown>;
        expect(json.status).toBe('completed');

        const rows = await database
          .select()
          .from(sessionChronicles)
          .where(eq(sessionChronicles.sessionId, sessionId));
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('failed');
        expect(rows[0].errorMessage).toContain('plan lookup db unavailable');
      } finally {
        planThrow.enabled = false;
      }
    });
  },
);
