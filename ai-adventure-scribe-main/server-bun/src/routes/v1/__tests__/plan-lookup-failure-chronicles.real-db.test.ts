/* eslint-disable max-lines */
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
process.env.CORS_ORIGIN ??= 'http://localhost:8891';

import {
  CHRONICLE_SHARE_REQUEST,
  CHRONICLE_UNSHARE_REQUEST,
  PUBLIC_CHRONICLE_PATH,
} from '../../../../../shared/test-fixtures/chronicle-share-wire';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

const USER_ID = testId('plan-fail-chronicle-user');
const OWNER_ID = testId('chronicle-share-owner');
const OTHER_ID = testId('chronicle-share-other');
const FREE_ID = testId('chronicle-share-free');
const SHARE_TOKEN = `share-token-${testId('x')}`;
const PREVIOUSLY_ON_TEXT = 'Previously fake recap for share tests.';
const CHRONICLE_TEXT = 'Once upon a test time there was a tale.';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.split(' ').at(-1) ?? '';
    if (token === USER_ID || token === OWNER_ID || token === OTHER_ID || token === FREE_ID) {
      return { user: { userId: token, plan: 'pro' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
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

const { chroniclesRouter } = await importWithRealDb(
  () => import('../../../trpc/routers/chronicles.js'),
);
const { campaigns, characters, gameSessions, sessionChronicles, users } = await importWithRealDb(
  () => import('../../../../../db/schema/index.js'),
);
const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { chroniclesV1Routes } = await importWithRealDb(() => import('../chronicles.js'));

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
      expect(failedRows[0].errorMessage).toBe('plan_lookup_failed');
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

describeWithDb('chronicle sharing is private until the owner shares (#1430)', () => {
  const app = hasRealDb ? createRequestPipelineApp().use(chroniclesV1Routes) : null;
  let ownerCampaignId = '';
  let ownerSessionId = '';
  let chronicleId = '';
  let freeCampaignId = '';
  let freeSessionId = '';
  let freeChronicleId = '';
  const freeToken = `free-token-${testId('x')}`;

  beforeAll(async () => {
    if (!hasRealDb) return;
    const database = realDb();
    await database
      .insert(users)
      .values({ id: OWNER_ID, email: 'share-owner@example.test', plan: 'pro' })
      .onConflictDoUpdate({ target: users.id, set: { plan: 'pro' } });
    await database
      .insert(users)
      .values({ id: OTHER_ID, email: 'share-other@example.test', plan: 'pro' })
      .onConflictDoUpdate({ target: users.id, set: { plan: 'pro' } });
    await database
      .insert(users)
      .values({ id: FREE_ID, email: 'share-free@example.test', plan: 'free' })
      .onConflictDoUpdate({ target: users.id, set: { plan: 'free' } });
    const [ownerCampaign] = await database
      .insert(campaigns)
      .values({ userId: OWNER_ID, name: 'Share Campaign' })
      .returning({ id: campaigns.id });
    ownerCampaignId = ownerCampaign.id;
    const [ownerSession] = await database
      .insert(gameSessions)
      .values({
        campaignId: ownerCampaignId,
        sessionNumber: 1,
        status: 'active',
        turnCount: 0,
      })
      .returning({ id: gameSessions.id });
    ownerSessionId = ownerSession.id;
    const [chronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: ownerSessionId,
        userId: OWNER_ID,
        status: 'ready',
        chronicleText: CHRONICLE_TEXT,
        chapterTitle: 'Chapter One',
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: SHARE_TOKEN,
        shareEnabled: false,
      })
      .returning({ id: sessionChronicles.id });
    chronicleId = chronicle.id;
    const [freeCampaign] = await database
      .insert(campaigns)
      .values({ userId: FREE_ID, name: 'Free Campaign' })
      .returning({ id: campaigns.id });
    freeCampaignId = freeCampaign.id;
    const [freeSession] = await database
      .insert(gameSessions)
      .values({
        campaignId: freeCampaignId,
        sessionNumber: 1,
        status: 'active',
        turnCount: 0,
      })
      .returning({ id: gameSessions.id });
    freeSessionId = freeSession.id;
    const [freeChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: freeSessionId,
        userId: FREE_ID,
        status: 'ready',
        chronicleText: CHRONICLE_TEXT,
        chapterTitle: 'Free Chapter',
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: freeToken,
        shareEnabled: false,
      })
      .returning({ id: sessionChronicles.id });
    freeChronicleId = freeChronicle.id;
  });

  afterAll(async () => {
    try {
      if (hasRealDb) {
        const database = realDb();
        if (ownerSessionId) {
          await database
            .delete(sessionChronicles)
            .where(eq(sessionChronicles.sessionId, ownerSessionId))
            .catch(() => {});
        }
        if (freeSessionId) {
          await database
            .delete(sessionChronicles)
            .where(eq(sessionChronicles.sessionId, freeSessionId))
            .catch(() => {});
        }
        if (ownerSessionId) {
          await database
            .delete(gameSessions)
            .where(eq(gameSessions.id, ownerSessionId))
            .catch(() => {});
        }
        if (freeSessionId) {
          await database
            .delete(gameSessions)
            .where(eq(gameSessions.id, freeSessionId))
            .catch(() => {});
        }
        if (ownerCampaignId) {
          await database
            .delete(campaigns)
            .where(eq(campaigns.id, ownerCampaignId))
            .catch(() => {});
        }
        if (freeCampaignId) {
          await database
            .delete(campaigns)
            .where(eq(campaigns.id, freeCampaignId))
            .catch(() => {});
        }
        await database
          .delete(users)
          .where(eq(users.id, OWNER_ID))
          .catch(() => {});
        await database
          .delete(users)
          .where(eq(users.id, OTHER_ID))
          .catch(() => {});
        await database
          .delete(users)
          .where(eq(users.id, FREE_ID))
          .catch(() => {});
      }
    } finally {
      await closeRealDb();
    }
  });

  test('owner share lifecycle keeps new chronicles private until shared', async () => {
    if (!hasRealDb || !app) return;
    const database = realDb();
    const handle = (app as unknown as { handle: (r: Request) => Promise<Response> }).handle.bind(
      app as unknown as { handle: (r: Request) => Promise<Response> },
    );

    const preShare = await handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(SHARE_TOKEN)}`, {
        method: 'GET',
      }),
    );
    expect(preShare.status).toBe(404);

    const otherPost = await handle(
      new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(chronicleId)}`, {
        method: CHRONICLE_SHARE_REQUEST.method,
        headers: { authorization: `Bearer ${OTHER_ID}` },
      }),
    );
    expect(otherPost.status).toBe(404);
    const unchanged = await database
      .select()
      .from(sessionChronicles)
      .where(eq(sessionChronicles.id, chronicleId));
    expect(unchanged[0].shareEnabled).toBe(false);
    expect(unchanged[0].shareToken).toBe(SHARE_TOKEN);

    const ownerPost = await handle(
      new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(chronicleId)}`, {
        method: CHRONICLE_SHARE_REQUEST.method,
        headers: { authorization: `Bearer ${OWNER_ID}` },
      }),
    );
    expect(ownerPost.status).toBe(200);
    const ownerJson = (await ownerPost.json()) as Record<string, unknown>;
    expect(ownerJson.shareEnabled).toBe(true);
    expect(ownerJson.shareToken).toBe(SHARE_TOKEN);
    const shared = await database
      .select()
      .from(sessionChronicles)
      .where(eq(sessionChronicles.id, chronicleId));
    expect(shared[0].shareEnabled).toBe(true);

    const pub = await handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(SHARE_TOKEN)}`, {
        method: 'GET',
      }),
    );
    expect(pub.status).toBe(200);
    const pubText = await pub.text();
    const pubJson = JSON.parse(pubText) as Record<string, unknown>;
    expect(Object.keys(pubJson).sort()).toEqual([
      'campaignName',
      'illustrationUrl',
      'sessionNumber',
      'story',
      'title',
    ]);
    expect(pubJson.title).toBe('Chapter One');
    expect(pubJson.story).toBe(CHRONICLE_TEXT);
    expect(pubText).not.toContain(PREVIOUSLY_ON_TEXT);

    const otherDel = await handle(
      new Request(`http://localhost${CHRONICLE_UNSHARE_REQUEST.path(chronicleId)}`, {
        method: CHRONICLE_UNSHARE_REQUEST.method,
        headers: { authorization: `Bearer ${OTHER_ID}` },
      }),
    );
    expect(otherDel.status).toBe(404);
    const stillShared = await database
      .select()
      .from(sessionChronicles)
      .where(eq(sessionChronicles.id, chronicleId));
    expect(stillShared[0].shareEnabled).toBe(true);
    expect(stillShared[0].shareToken).toBe(SHARE_TOKEN);

    const ownerDel = await handle(
      new Request(`http://localhost${CHRONICLE_UNSHARE_REQUEST.path(chronicleId)}`, {
        method: CHRONICLE_UNSHARE_REQUEST.method,
        headers: { authorization: `Bearer ${OWNER_ID}` },
      }),
    );
    expect(ownerDel.status).toBe(200);
    const revoked = await database
      .select()
      .from(sessionChronicles)
      .where(eq(sessionChronicles.id, chronicleId));
    expect(revoked[0].shareEnabled).toBe(false);
    expect(revoked[0].shareToken).toBeNull();
    const afterRevoke = await handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(SHARE_TOKEN)}`, {
        method: 'GET',
      }),
    );
    expect(afterRevoke.status).toBe(404);
  });

  test('free-plan owner gets 403 when sharing', async () => {
    if (!hasRealDb || !app) return;
    const database = realDb();
    const handle = (app as unknown as { handle: (r: Request) => Promise<Response> }).handle.bind(
      app as unknown as { handle: (r: Request) => Promise<Response> },
    );
    const freePost = await handle(
      new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(freeChronicleId)}`, {
        method: CHRONICLE_SHARE_REQUEST.method,
        headers: { authorization: `Bearer ${FREE_ID}` },
      }),
    );
    expect(freePost.status).toBe(403);
    const freeRow = await database
      .select()
      .from(sessionChronicles)
      .where(eq(sessionChronicles.id, freeChronicleId));
    expect(freeRow[0].shareEnabled).toBe(false);
  });
});
