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
import { afterAll, beforeAll, expect, mock, spyOn, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';

process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';

import {
  CHRONICLE_SHARE_REQUEST,
  CHRONICLE_UNSHARE_REQUEST,
  PUBLIC_CHRONICLE_PATH,
} from '../../../../../shared/chronicle-share-routes';
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
const RACE_ID = testId('chronicle-share-race');
const CONCURRENT_ID = testId('chronicle-share-concurrent');
const UPGRADE_ID = testId('chronicle-share-upgrade');
const LEGACY_ID = testId('chronicle-share-legacy');
const CAMPAIGN_ID = testId('chronicle-share-campaign');
const SHARE_TOKEN = `share-token-${testId('x')}`;
const PREVIOUSLY_ON_TEXT = 'Previously fake recap for share tests.';
const CHRONICLE_TEXT = 'Once upon a test time there was a tale.';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.split(' ').at(-1) ?? '';
    if (
      token === USER_ID ||
      token === OWNER_ID ||
      token === OTHER_ID ||
      token === FREE_ID ||
      token === RACE_ID ||
      token === CONCURRENT_ID ||
      token === UPGRADE_ID ||
      token === LEGACY_ID ||
      token === CAMPAIGN_ID
    ) {
      return { user: { userId: token, plan: 'pro' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

// Throw the plan query only while the flag is on; otherwise read the real row.
const planThrow = { enabled: false };
// Hold the plan query on a gate while set, so a test can interleave a DELETE.
const planDelay: {
  gate: Promise<void> | null;
  enteredSignal: (() => void) | null;
} = { gate: null, enteredSignal: null };
mock.module('../../../lib/db.js', () => ({
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ');
    if (text.includes('SELECT plan FROM users')) {
      if (planThrow.enabled) throw new Error('plan lookup db unavailable (test injection)');
      if (planDelay.gate) {
        planDelay.enteredSignal?.();
        await planDelay.gate;
      }
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
const { campaigns, characters, gameSessions, sessionChronicles, starterCampaigns, users } =
  await importWithRealDb(() => import('../../../../../db/schema/index.js'));
const { chronicleGenerator } = await importWithRealDb(
  () => import('../../../services/chronicle-generator.js'),
);
const { createRequestPipelineApp } = await importWithRealDb(
  () => import('../../../http-pipeline.js'),
);
const { chroniclesV1Routes } = await importWithRealDb(() => import('../chronicles.js'));
const { chronicleRoutes } = await importWithRealDb(() => import('../../chronicle.js'));

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
    // publicCampaign added for the board's Play this campaign aside (#1430 review)
    expect(Object.keys(pubJson).sort()).toEqual([
      'campaignName',
      'illustrationUrl',
      'publicCampaign',
      'sessionNumber',
      'story',
      'title',
    ]);
    expect(pubJson.publicCampaign).toBeNull();
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

describeWithDb('chronicle share race and concurrent first share (#1430 review FIX1)', () => {
  const app = hasRealDb ? createRequestPipelineApp().use(chroniclesV1Routes) : null;
  let raceCampaignId = '';
  let raceSessionId = '';
  let raceChronicleId = '';
  let concurrentCampaignId = '';
  let concurrentSessionId = '';
  let concurrentChronicleId = '';
  const raceToken = `race-token-${testId('x')}`;

  beforeAll(async () => {
    if (!hasRealDb) return;
    const database = realDb();
    await database
      .insert(users)
      .values({ id: RACE_ID, email: 'share-race@example.test', plan: 'pro' })
      .onConflictDoUpdate({ target: users.id, set: { plan: 'pro' } });
    await database
      .insert(users)
      .values({ id: CONCURRENT_ID, email: 'share-concurrent@example.test', plan: 'pro' })
      .onConflictDoUpdate({ target: users.id, set: { plan: 'pro' } });
    const [raceCampaign] = await database
      .insert(campaigns)
      .values({ userId: RACE_ID, name: 'Race Campaign' })
      .returning({ id: campaigns.id });
    raceCampaignId = raceCampaign.id;
    const [raceSession] = await database
      .insert(gameSessions)
      .values({ campaignId: raceCampaignId, sessionNumber: 1, status: 'active', turnCount: 0 })
      .returning({ id: gameSessions.id });
    raceSessionId = raceSession.id;
    const [raceChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: raceSessionId,
        userId: RACE_ID,
        status: 'ready',
        chronicleText: CHRONICLE_TEXT,
        chapterTitle: 'Race Chapter',
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: raceToken,
        shareEnabled: true,
      })
      .returning({ id: sessionChronicles.id });
    raceChronicleId = raceChronicle.id;
    const [concurrentCampaign] = await database
      .insert(campaigns)
      .values({ userId: CONCURRENT_ID, name: 'Concurrent Campaign' })
      .returning({ id: campaigns.id });
    concurrentCampaignId = concurrentCampaign.id;
    const [concurrentSession] = await database
      .insert(gameSessions)
      .values({
        campaignId: concurrentCampaignId,
        sessionNumber: 1,
        status: 'active',
        turnCount: 0,
      })
      .returning({ id: gameSessions.id });
    concurrentSessionId = concurrentSession.id;
    const [concurrentChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: concurrentSessionId,
        userId: CONCURRENT_ID,
        status: 'ready',
        chronicleText: CHRONICLE_TEXT,
        chapterTitle: 'Concurrent Chapter',
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: null,
        shareEnabled: false,
      })
      .returning({ id: sessionChronicles.id });
    concurrentChronicleId = concurrentChronicle.id;
  });

  afterAll(async () => {
    try {
      if (hasRealDb) {
        const database = realDb();
        for (const sessionId of [raceSessionId, concurrentSessionId]) {
          if (sessionId) {
            await database
              .delete(sessionChronicles)
              .where(eq(sessionChronicles.sessionId, sessionId))
              .catch(() => {});
            await database
              .delete(gameSessions)
              .where(eq(gameSessions.id, sessionId))
              .catch(() => {});
          }
        }
        for (const campaignId of [raceCampaignId, concurrentCampaignId]) {
          if (campaignId) {
            await database
              .delete(campaigns)
              .where(eq(campaigns.id, campaignId))
              .catch(() => {});
          }
        }
        await database
          .delete(users)
          .where(eq(users.id, RACE_ID))
          .catch(() => {});
        await database
          .delete(users)
          .where(eq(users.id, CONCURRENT_ID))
          .catch(() => {});
      }
    } finally {
      await closeRealDb();
    }
  });

  test('delayed POST does not resurrect a revoked token', async () => {
    if (!hasRealDb || !app) return;
    const database = realDb();
    const handle = (app as unknown as { handle: (r: Request) => Promise<Response> }).handle.bind(
      app as unknown as { handle: (r: Request) => Promise<Response> },
    );
    let releaseGate!: () => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    planDelay.gate = gate;
    planDelay.enteredSignal = signalEntered;
    try {
      const postPromise = handle(
        new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(raceChronicleId)}`, {
          method: CHRONICLE_SHARE_REQUEST.method,
          headers: { authorization: `Bearer ${RACE_ID}` },
        }),
      );
      await entered;
      const deleteRes = await handle(
        new Request(`http://localhost${CHRONICLE_UNSHARE_REQUEST.path(raceChronicleId)}`, {
          method: CHRONICLE_UNSHARE_REQUEST.method,
          headers: { authorization: `Bearer ${RACE_ID}` },
        }),
      );
      expect(deleteRes.status).toBe(200);
      releaseGate();
      const postRes = await postPromise;
      expect(postRes.status).toBe(200);
      const postJson = (await postRes.json()) as Record<string, unknown>;
      expect(postJson.shareToken).not.toBe(raceToken);
      const rows = await database
        .select()
        .from(sessionChronicles)
        .where(eq(sessionChronicles.id, raceChronicleId));
      expect(rows[0].shareToken).toBe(postJson.shareToken as string);
      const pubT1 = await handle(
        new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(raceToken)}`, { method: 'GET' }),
      );
      expect(pubT1.status).toBe(404);
    } finally {
      planDelay.gate = null;
      planDelay.enteredSignal = null;
      releaseGate();
    }
  });

  test('concurrent first share yields one token', async () => {
    if (!hasRealDb || !app) return;
    const database = realDb();
    const handle = (app as unknown as { handle: (r: Request) => Promise<Response> }).handle.bind(
      app as unknown as { handle: (r: Request) => Promise<Response> },
    );
    const [res1, res2] = await Promise.all([
      handle(
        new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(concurrentChronicleId)}`, {
          method: CHRONICLE_SHARE_REQUEST.method,
          headers: { authorization: `Bearer ${CONCURRENT_ID}` },
        }),
      ),
      handle(
        new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(concurrentChronicleId)}`, {
          method: CHRONICLE_SHARE_REQUEST.method,
          headers: { authorization: `Bearer ${CONCURRENT_ID}` },
        }),
      ),
    ]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const json1 = (await res1.json()) as Record<string, unknown>;
    const json2 = (await res2.json()) as Record<string, unknown>;
    expect(json1.shareToken).toBe(json2.shareToken);
    const rows = await database
      .select()
      .from(sessionChronicles)
      .where(eq(sessionChronicles.id, concurrentChronicleId));
    expect(rows[0].shareToken).toBe(json1.shareToken as string);
    expect(rows[0].shareEnabled).toBe(true);
  });
});

describeWithDb('free summary chronicle upgrades to Pro on generate (#1430 review FIX3)', () => {
  const app = hasRealDb ? createRequestPipelineApp().use(chroniclesV1Routes) : null;
  let upgradeCampaignId = '';
  let upgradeSessionId = '';
  let upgradeChronicleId = '';

  beforeAll(async () => {
    if (!hasRealDb) return;
    const database = realDb();
    await database
      .insert(users)
      .values({ id: UPGRADE_ID, email: 'share-upgrade@example.test', plan: 'pro' })
      .onConflictDoUpdate({ target: users.id, set: { plan: 'pro' } });
    const [upgradeCampaign] = await database
      .insert(campaigns)
      .values({ userId: UPGRADE_ID, name: 'Upgrade Campaign' })
      .returning({ id: campaigns.id });
    upgradeCampaignId = upgradeCampaign.id;
    const [upgradeSession] = await database
      .insert(gameSessions)
      .values({ campaignId: upgradeCampaignId, sessionNumber: 1, status: 'active', turnCount: 0 })
      .returning({ id: gameSessions.id });
    upgradeSessionId = upgradeSession.id;
    const [upgradeChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: upgradeSessionId,
        userId: UPGRADE_ID,
        status: 'ready',
        chronicleText: 'Free summary text.',
        chapterTitle: null,
        previouslyOn: PREVIOUSLY_ON_TEXT,
        illustrationUrl: null,
        shareToken: null,
        shareEnabled: false,
      })
      .returning({ id: sessionChronicles.id });
    upgradeChronicleId = upgradeChronicle.id;
  });

  afterAll(async () => {
    try {
      if (hasRealDb) {
        const database = realDb();
        if (upgradeSessionId) {
          await database
            .delete(sessionChronicles)
            .where(eq(sessionChronicles.sessionId, upgradeSessionId))
            .catch(() => {});
          await database
            .delete(gameSessions)
            .where(eq(gameSessions.id, upgradeSessionId))
            .catch(() => {});
        }
        if (upgradeCampaignId) {
          await database
            .delete(campaigns)
            .where(eq(campaigns.id, upgradeCampaignId))
            .catch(() => {});
        }
        await database
          .delete(users)
          .where(eq(users.id, UPGRADE_ID))
          .catch(() => {});
      }
    } finally {
      await closeRealDb();
    }
  });

  test('summary row is not shareable, generate upgrades it, then it shares', async () => {
    if (!hasRealDb || !app) return;
    const database = realDb();
    const handle = (app as unknown as { handle: (r: Request) => Promise<Response> }).handle.bind(
      app as unknown as { handle: (r: Request) => Promise<Response> },
    );
    const post = await handle(
      new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(upgradeChronicleId)}`, {
        method: CHRONICLE_SHARE_REQUEST.method,
        headers: { authorization: `Bearer ${UPGRADE_ID}` },
      }),
    );
    expect(post.status).toBe(409);
    expect(await post.json()).toEqual({ error: 'Write the full chronicle before sharing' });
    const pubBefore = await handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH('no-such-token')}`, { method: 'GET' }),
    );
    expect(pubBefore.status).toBe(404);

    const proSpy = spyOn(chronicleGenerator, 'generateProChronicle').mockResolvedValue({
      chronicleText: 'Upgraded full chronicle text.',
      chapterTitle: 'Upgraded Chapter',
      previouslyOn: PREVIOUSLY_ON_TEXT,
      illustrationPrompt: 'fake illustration prompt',
    });
    const illustrationSpy = spyOn(chronicleGenerator, 'generateIllustration').mockResolvedValue(
      'https://example.test/fake-illustration.png',
    );
    try {
      const caller = chroniclesRouter.createCaller({
        user: { userId: UPGRADE_ID, plan: 'pro' },
        db: database,
      } as never);
      const gen = await caller.generate({ sessionId: upgradeSessionId });
      expect(gen).toEqual({ chronicleId: upgradeChronicleId, generating: true });
      let upgraded: { status: string; chapterTitle: string | null } | undefined;
      for (let i = 0; i < 40; i++) {
        const rows = await database
          .select()
          .from(sessionChronicles)
          .where(eq(sessionChronicles.id, upgradeChronicleId));
        upgraded = rows[0];
        if (upgraded?.status === 'ready' && upgraded.chapterTitle) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(upgraded?.status).toBe('ready');
      expect(upgraded?.chapterTitle).toBe('Upgraded Chapter');
      expect(proSpy).toHaveBeenCalled();
      expect(illustrationSpy).toHaveBeenCalled();
    } finally {
      proSpy.mockRestore();
      illustrationSpy.mockRestore();
    }

    const sharePost = await handle(
      new Request(`http://localhost${CHRONICLE_SHARE_REQUEST.path(upgradeChronicleId)}`, {
        method: CHRONICLE_SHARE_REQUEST.method,
        headers: { authorization: `Bearer ${UPGRADE_ID}` },
      }),
    );
    expect(sharePost.status).toBe(200);
    const shareJson = (await sharePost.json()) as Record<string, unknown>;
    const pub = await handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(shareJson.shareToken as string)}`, {
        method: 'GET',
      }),
    );
    expect(pub.status).toBe(200);
    const pubJson = (await pub.json()) as Record<string, unknown>;
    expect(pubJson.title).toBe('Upgraded Chapter');
  });
});

describeWithDb('publicCampaign and legacy chronicle redirect (#1430 review FIX5/FIX6)', () => {
  const app = hasRealDb ? createRequestPipelineApp().use(chroniclesV1Routes) : null;
  const legacyApp = hasRealDb ? createRequestPipelineApp().use(chronicleRoutes) : null;
  let campaignId = '';
  let mainSessionId = '';
  let mainChronicleId = '';
  let secondSessionId = '';
  let secondChronicleId = '';
  let summarySessionId = '';
  let summaryChronicleId = '';
  let revokedSessionId = '';
  let revokedChronicleId = '';
  let publishedStarterId = '';
  let unpublishedStarterId = '';
  const mainToken = `campaign-token-${testId('x')}`;
  const secondToken = `campaign-second-${testId('x')}`;
  const summaryToken = `campaign-summary-${testId('x')}`;
  const revokedToken = `campaign-revoked-${testId('x')}`;
  const publishedSlug = `test-chronicle-starter-${testId('x')}`;
  const unpublishedSlug = `test-chronicle-starter-${testId('x')}`;

  beforeAll(async () => {
    if (!hasRealDb) return;
    const database = realDb();
    await database
      .insert(users)
      .values({ id: CAMPAIGN_ID, email: 'share-campaign@example.test', plan: 'pro' })
      .onConflictDoUpdate({ target: users.id, set: { plan: 'pro' } });
    publishedStarterId = testId('starter');
    unpublishedStarterId = testId('starter');
    await database.insert(starterCampaigns).values({
      id: publishedStarterId,
      slug: publishedSlug,
      title: 'Published Starter Title',
      tagline: 'Published tagline',
      genre: ['fixture'],
      tone: ['fixture'],
      difficulty: 'medium',
      premise: 'A published starter for the chronicle test.',
      isPublished: true,
      coverImageUrl: 'https://example.test/cover.png',
    });
    await database.insert(starterCampaigns).values({
      id: unpublishedStarterId,
      slug: unpublishedSlug,
      title: 'Unpublished Starter Title',
      tagline: 'Unpublished tagline',
      genre: ['fixture'],
      tone: ['fixture'],
      difficulty: 'medium',
      premise: 'An unpublished starter for the chronicle test.',
      isPublished: false,
      coverImageUrl: 'https://example.test/unpublished-cover.png',
    });
    const [campaign] = await database
      .insert(campaigns)
      .values({ userId: CAMPAIGN_ID, name: 'Public Campaign Test' })
      .returning({ id: campaigns.id });
    campaignId = campaign.id;
    const seedSession = async (starterCampaignId: string | null): Promise<string> => {
      const [session] = await database
        .insert(gameSessions)
        .values({
          campaignId,
          sessionNumber: 1,
          status: 'active',
          turnCount: 0,
          starterCampaignId,
        })
        .returning({ id: gameSessions.id });
      return session.id;
    };
    mainSessionId = await seedSession(publishedStarterId);
    const [mainChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: mainSessionId,
        userId: CAMPAIGN_ID,
        status: 'ready',
        chronicleText: CHRONICLE_TEXT,
        chapterTitle: 'Campaign Chapter',
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: mainToken,
        shareEnabled: true,
      })
      .returning({ id: sessionChronicles.id });
    mainChronicleId = mainChronicle.id;
    secondSessionId = await seedSession(unpublishedStarterId);
    const [secondChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: secondSessionId,
        userId: CAMPAIGN_ID,
        status: 'ready',
        chronicleText: CHRONICLE_TEXT,
        chapterTitle: 'Second Chapter',
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: secondToken,
        shareEnabled: true,
      })
      .returning({ id: sessionChronicles.id });
    secondChronicleId = secondChronicle.id;
    summarySessionId = await seedSession(null);
    const [summaryChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: summarySessionId,
        userId: CAMPAIGN_ID,
        status: 'ready',
        chronicleText: 'Summary only.',
        chapterTitle: null,
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: summaryToken,
        shareEnabled: true,
      })
      .returning({ id: sessionChronicles.id });
    summaryChronicleId = summaryChronicle.id;
    revokedSessionId = await seedSession(null);
    const [revokedChronicle] = await database
      .insert(sessionChronicles)
      .values({
        sessionId: revokedSessionId,
        userId: CAMPAIGN_ID,
        status: 'ready',
        chronicleText: CHRONICLE_TEXT,
        chapterTitle: 'Revoked Chapter',
        previouslyOn: PREVIOUSLY_ON_TEXT,
        shareToken: revokedToken,
        shareEnabled: false,
      })
      .returning({ id: sessionChronicles.id });
    revokedChronicleId = revokedChronicle.id;
  });

  afterAll(async () => {
    try {
      if (hasRealDb) {
        const database = realDb();
        for (const sessionId of [
          mainSessionId,
          secondSessionId,
          summarySessionId,
          revokedSessionId,
        ]) {
          if (sessionId) {
            await database
              .delete(sessionChronicles)
              .where(eq(sessionChronicles.sessionId, sessionId))
              .catch(() => {});
            await database
              .delete(gameSessions)
              .where(eq(gameSessions.id, sessionId))
              .catch(() => {});
          }
        }
        if (campaignId) {
          await database
            .delete(campaigns)
            .where(eq(campaigns.id, campaignId))
            .catch(() => {});
        }
        if (publishedStarterId) {
          await database
            .delete(starterCampaigns)
            .where(eq(starterCampaigns.id, publishedStarterId))
            .catch(() => {});
        }
        if (unpublishedStarterId) {
          await database
            .delete(starterCampaigns)
            .where(eq(starterCampaigns.id, unpublishedStarterId))
            .catch(() => {});
        }
        await database
          .delete(users)
          .where(eq(users.id, CAMPAIGN_ID))
          .catch(() => {});
      }
    } finally {
      await closeRealDb();
    }
  });

  test('public GET exposes only the published starter campaign fields', async () => {
    if (!hasRealDb || !app) return;
    const handle = (app as unknown as { handle: (r: Request) => Promise<Response> }).handle.bind(
      app as unknown as { handle: (r: Request) => Promise<Response> },
    );
    const pub = await handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(mainToken)}`, { method: 'GET' }),
    );
    expect(pub.status).toBe(200);
    const pubJson = (await pub.json()) as Record<string, unknown>;
    expect(pubJson.publicCampaign).toEqual({
      slug: publishedSlug,
      title: 'Published Starter Title',
      tagline: 'Published tagline',
      coverImageUrl: 'https://example.test/cover.png',
    });
    const pubSecond = await handle(
      new Request(`http://localhost${PUBLIC_CHRONICLE_PATH(secondToken)}`, { method: 'GET' }),
    );
    expect(pubSecond.status).toBe(200);
    const pubSecondJson = (await pubSecond.json()) as Record<string, unknown>;
    expect(pubSecondJson.publicCampaign).toBeNull();
    expect(mainChronicleId).toBeTruthy();
    expect(secondChronicleId).toBeTruthy();
    expect(summaryChronicleId).toBeTruthy();
    expect(revokedChronicleId).toBeTruthy();
  });

  test('legacy /chronicle/:token redirects to the app reader, 404s otherwise', async () => {
    if (!hasRealDb || !legacyApp) return;
    const handle = (
      legacyApp as unknown as { handle: (r: Request) => Promise<Response> }
    ).handle.bind(legacyApp as unknown as { handle: (r: Request) => Promise<Response> });
    const appOrigin = process.env.CORS_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:8891';

    const shared = await handle(
      new Request(`http://localhost/chronicle/${mainToken}`, { method: 'GET' }),
    );
    expect(shared.status).toBe(302);
    expect(shared.headers.get('location')).toBe(`${appOrigin}/chronicle/${mainToken}`);
    expect(shared.headers.get('cache-control')).toBe('no-store');

    const revoked = await handle(
      new Request(`http://localhost/chronicle/${revokedToken}`, { method: 'GET' }),
    );
    expect(revoked.status).toBe(404);
    expect(revoked.headers.get('location')).toBeNull();
    expect(revoked.headers.get('cache-control')).toBe('no-store');

    const summary = await handle(
      new Request(`http://localhost/chronicle/${summaryToken}`, { method: 'GET' }),
    );
    expect(summary.status).toBe(404);
    expect(summary.headers.get('location')).toBeNull();

    const appHost = new URL(appOrigin).host;
    const loopGuard = await handle(
      new Request(`http://localhost/chronicle/${mainToken}`, {
        method: 'GET',
        headers: { host: appHost },
      }),
    );
    expect(loopGuard.status).toBe(200);
    expect(loopGuard.headers.get('location')).toBeNull();
    expect(loopGuard.headers.get('content-type')).toContain('text/html');
  });
});
