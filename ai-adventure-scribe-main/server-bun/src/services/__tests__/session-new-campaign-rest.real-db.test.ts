/**
 * #1239 item 2 — a hero joins a NEW campaign rested, exactly once.
 *
 * Real-route test: sessions are created through the real POST /v1/sessions
 * route (createRequestPipelineApp + sessionsRoutes), never through a mocked
 * SessionService, and HP is read back from characterStats, not from a
 * response body.
 *
 * Fixtures follow the real producers:
 * - session rows: the real session-create producer, SessionService.createSession,
 *   reached through the route above.
 * - the join rest: the real long-rest producer, RestService.takeLongRest,
 *   invoked by createSession itself — the test never calls it directly.
 * - HP/slot/dice/feature rows: the shapes the sheet's real producers write
 *   (same columns as rest-long-rest-recovery.real-db.test.ts).
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 * Auth is stubbed. SessionService and RestService are not.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { desc, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterFeatures,
  characterHitDice,
  characterSpellSlots,
  characterStats,
  characters,
  classFeaturesLibrary,
  gameSessions,
  restEvents,
} from '../../../../db/schema/index.js';

const stub = () => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});

let userId = '';

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token'
      ? { user: { userId, email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

mock.module('../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
  default: stub(),
}));

mock.module('../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));

process.env.CORS_ORIGIN ??= 'http://localhost:3000';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.PORT ??= '3000';

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../http-pipeline.js');
  const { sessionsRoutes } = await import('../../routes/v1/sessions.js');
  return createRequestPipelineApp().use(sessionsRoutes);
});

const authHeaders = {
  authorization: 'Bearer test-token',
  'content-type': 'application/json',
};

describeWithDb('session new-campaign join rest (#1239 item 2)', () => {
  let campaignA = '';
  let campaignB = '';
  let campaignC = '';
  let campaignD = '';
  let campaignE = '';
  let heroId = '';
  let dyingHeroId = '';
  let deadHeroId = '';
  let replayHeroId = '';
  let libraryFeatureId = '';

  beforeAll(async () => {
    if (!hasRealDb) return;
    const db = realDb();
    userId = testId('new-camp-rest-user');

    [{ id: campaignA }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp-a') })
      .returning({ id: campaigns.id });
    [{ id: campaignB }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp-b') })
      .returning({ id: campaigns.id });
    [{ id: campaignC }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp-c') })
      .returning({ id: campaigns.id });
    [{ id: campaignD }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp-d') })
      .returning({ id: campaigns.id });
    [{ id: campaignE }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp-e') })
      .returning({ id: campaigns.id });

    [{ id: heroId }] = await db
      .insert(characters)
      .values({ userId, campaignId: campaignA, name: testId('hero'), level: 1, class: 'Fighter' })
      .returning({ id: characters.id });
    // Mid-adventure state: hurt, slots spent, hit dice spent, feature spent.
    await db.insert(characterStats).values({
      characterId: heroId,
      maxHitPoints: 28,
      currentHitPoints: 10,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    await db.insert(characterSpellSlots).values({
      characterId: heroId,
      spellLevel: 1,
      totalSlots: 2,
      usedSlots: 2,
    });
    await db.insert(characterHitDice).values({
      characterId: heroId,
      className: 'Fighter',
      dieType: 'd10',
      totalDice: 4,
      usedDice: 3,
    });
    [{ id: libraryFeatureId }] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Fighter',
        featureName: testId('second-wind-test'),
        levelAcquired: 1,
        description: 'Test feature for the join-rest suite.',
        usageType: 'limited_use',
        usesPerRest: 'long_rest',
        usesCount: 1,
      })
      .returning({ id: classFeaturesLibrary.id });
    await db.insert(characterFeatures).values({
      characterId: heroId,
      featureId: libraryFeatureId,
      usesRemaining: 0,
      acquiredAtLevel: 1,
    });

    [{ id: dyingHeroId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campaignC,
        name: testId('dying-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: dyingHeroId,
      maxHitPoints: 28,
      currentHitPoints: 0,
      temporaryHitPoints: 0,
      isConscious: false,
      vitalState: 'dying',
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });

    [{ id: deadHeroId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campaignD,
        name: testId('dead-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: deadHeroId,
      maxHitPoints: 28,
      currentHitPoints: 0,
      temporaryHitPoints: 0,
      isConscious: false,
      vitalState: 'dead',
      deathSavesSuccesses: 0,
      deathSavesFailures: 3,
    });

    [{ id: replayHeroId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId: campaignE,
        name: testId('replay-hero'),
        level: 1,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: replayHeroId,
      maxHitPoints: 28,
      currentHitPoints: 10,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const db = realDb();
    const drop = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        /* fixture teardown is best-effort */
      }
    };
    for (const characterId of [heroId, dyingHeroId, deadHeroId, replayHeroId]) {
      await drop(() => db.delete(restEvents).where(eq(restEvents.characterId, characterId)));
      await drop(() =>
        db.delete(characterHitDice).where(eq(characterHitDice.characterId, characterId)),
      );
      await drop(() =>
        db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId)),
      );
      await drop(() =>
        db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId)),
      );
      await drop(() =>
        db.delete(characterStats).where(eq(characterStats.characterId, characterId)),
      );
      await drop(() => db.delete(gameSessions).where(eq(gameSessions.characterId, characterId)));
      await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    }
    await drop(() =>
      db.delete(classFeaturesLibrary).where(eq(classFeaturesLibrary.id, libraryFeatureId)),
    );
    for (const campaignId of [campaignA, campaignB, campaignC, campaignD, campaignE]) {
      await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    }
    await closeRealDb();
  });

  const createSession = (body: Record<string, unknown>): Promise<Response> =>
    pipeline.handle(
      new Request('http://localhost/v1/sessions', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(body),
      }),
    );

  const currentHp = async (characterId: string): Promise<number> => {
    const [row] = await realDb()
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    return row.currentHitPoints;
  };

  const restEventsFor = async (characterId: string) =>
    realDb()
      .select()
      .from(restEvents)
      .where(eq(restEvents.characterId, characterId))
      .orderBy(desc(restEvents.startedAt));

  it('first session for a pair rests the hero to full — HP, slots, dice, features', async () => {
    const res = await createSession({
      campaign_id: campaignA,
      character_id: heroId,
      session_number: 1,
      status: 'active',
    });
    expect(res.status).toBe(201);
    const session = (await res.json()) as { id: string };

    expect(await currentHp(heroId)).toBe(28);

    // All spell slots restored.
    const [slots] = await realDb()
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, heroId));
    expect(slots.usedSlots).toBe(0);
    expect(slots.totalSlots).toBe(2);

    // Half of 4 total, rounded down: 2 restored, 3 used -> 1 used.
    const [hitDice] = await realDb()
      .select()
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, heroId));
    expect(hitDice.usedDice).toBe(1);

    // The spent feature refills from its library row.
    const [feature] = await realDb()
      .select()
      .from(characterFeatures)
      .where(eq(characterFeatures.characterId, heroId));
    expect(feature.usesRemaining).toBe(1);

    // Exactly one rest event, the real long-rest producer's row, tied to this
    // session, recording what the rest restored.
    const events = await restEventsFor(heroId);
    expect(events.length).toBe(1);
    expect(events[0].restType).toBe('long');
    expect(events[0].sessionId).toBe(session.id);
    expect(events[0].hpRestored).toBe(18);
    expect(events[0].notes).toBe('New campaign join rest (#1239 item 2)');
  });

  it('a restart — session_number 1 for a pair with history — does NOT re-rest', async () => {
    // Damage taken during the first session.
    await realDb()
      .update(characterStats)
      .set({ currentHitPoints: 20 })
      .where(eq(characterStats.characterId, heroId));

    // The naive session_number === 1 gate would rest here. Rule (A) must not.
    const res = await createSession({
      campaign_id: campaignA,
      character_id: heroId,
      session_number: 1,
      status: 'active',
    });
    expect(res.status).toBe(201);

    expect(await currentHp(heroId)).toBe(20);
    expect((await restEventsFor(heroId)).length).toBe(1);
  });

  it('second session in the same campaign does NOT re-rest', async () => {
    const res = await createSession({
      campaign_id: campaignA,
      character_id: heroId,
      session_number: 2,
      status: 'active',
    });
    expect(res.status).toBe(201);

    expect(await currentHp(heroId)).toBe(20);
    expect((await restEventsFor(heroId)).length).toBe(1);
  });

  it('a new campaign for the same hero rests again (pair-scoped, not hero-scoped)', async () => {
    const res = await createSession({
      campaign_id: campaignB,
      character_id: heroId,
      session_number: 1,
      status: 'active',
    });
    expect(res.status).toBe(201);

    expect(await currentHp(heroId)).toBe(28);
    expect((await restEventsFor(heroId)).length).toBe(2);
  });

  it('campaign-only and character-only creates do not rest', async () => {
    const campaignOnly = await createSession({
      campaign_id: campaignB,
      session_number: 1,
      status: 'active',
    });
    expect(campaignOnly.status).toBe(201);

    const characterOnly = await createSession({
      character_id: heroId,
      session_number: 1,
      status: 'active',
    });
    expect(characterOnly.status).toBe(201);

    expect(await currentHp(heroId)).toBe(28);
    expect((await restEventsFor(heroId)).length).toBe(2);
  });

  it('a dying hero joins a new campaign unrested, but the session is still created', async () => {
    const res = await createSession({
      campaign_id: campaignC,
      character_id: dyingHeroId,
      session_number: 1,
      status: 'active',
    });
    expect(res.status).toBe(201);

    expect(await currentHp(dyingHeroId)).toBe(0);
    expect((await restEventsFor(dyingHeroId)).length).toBe(0);
  });

  it('a dead hero joins a new campaign unrested, but the session is still created', async () => {
    const res = await createSession({
      campaign_id: campaignD,
      character_id: deadHeroId,
      session_number: 1,
      status: 'active',
    });
    expect(res.status).toBe(201);

    expect(await currentHp(deadHeroId)).toBe(0);
    expect((await restEventsFor(deadHeroId)).length).toBe(0);
  });

  it('a non-active first row consumes first-join status: the next active create does not rest', async () => {
    const completed = await createSession({
      campaign_id: campaignE,
      character_id: replayHeroId,
      session_number: 1,
      status: 'completed',
    });
    expect(completed.status).toBe(201);
    expect(await currentHp(replayHeroId)).toBe(10);

    const active = await createSession({
      campaign_id: campaignE,
      character_id: replayHeroId,
      session_number: 2,
      status: 'active',
    });
    expect(active.status).toBe(201);
    expect(await currentHp(replayHeroId)).toBe(10);
    expect((await restEventsFor(replayHeroId)).length).toBe(0);
  });
});
