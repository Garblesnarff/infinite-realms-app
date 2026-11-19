/**
 * #1669: Start new session and Resume session are two choices. Runs the real sessions route
 * (POST /v1/sessions/:id/resume, GET /v1/sessions/resumable, POST /v1/sessions) against the real
 * database. Runs only in the real-DB CI job (TEST_DATABASE_URL); never against a shared database.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  dialogueHistory,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db.js';

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
if (hasRealDb) {
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-api-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client-id';
  process.env.PORT ??= '8888';
}

const ownerId = testId('1669-owner');
const strangerId = testId('1669-stranger');
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const header = request.headers.get('authorization');
    if (header === 'Bearer 1669-owner-token') {
      return { user: { userId: ownerId, email: 'owner@example.test', plan: 'free' }, error: null };
    }
    if (header === 'Bearer 1669-stranger-token') {
      return {
        user: { userId: strangerId, email: 'stranger@example.test', plan: 'free' },
        error: null,
      };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { sessionsRoutes } = await import('../sessions.js');
  return createRequestPipelineApp().use(sessionsRoutes);
});

const TRACKER = {
  tracker: { phase: 'exploring', clocks: [{ name: 'Siege', value: 2, limit: 6 }] },
};

describeWithDb('Start new session and Resume session are two choices (#1669)', () => {
  let db: ReturnType<typeof realDb>;
  const owner = { authorization: 'Bearer 1669-owner-token', 'content-type': 'application/json' };
  const stranger = {
    authorization: 'Bearer 1669-stranger-token',
    'content-type': 'application/json',
  };

  /** One adventure (campaign) with one hero, and an ended session with messages and a tracker. */
  const seedAdventure = async (opts: {
    campaignLength?: string | null;
    vitalState?: 'standing' | 'dead';
  }) => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({
        userId: ownerId,
        name: testId('1669-camp'),
        campaignLength: opts.campaignLength ?? null,
      })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId: ownerId,
        campaignId,
        name: testId('1669-hero'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      charisma: 8,
      maxHitPoints: 12,
      currentHitPoints: opts.vitalState === 'dead' ? 0 : 12,
      temporaryHitPoints: 0,
      isConscious: opts.vitalState !== 'dead',
      vitalState: opts.vitalState ?? 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        status: 'completed',
        sessionNumber: 1,
        endTime: new Date(),
        summary: 'The party broke off the fight at the gate.',
        currentSceneDescription: 'The gate of Harrowmere.',
        sessionState: TRACKER,
        turnCount: 3,
      })
      .returning({ id: gameSessions.id });
    await db.insert(dialogueHistory).values([
      { sessionId, speakerType: 'player', message: 'I draw my sword.', sequenceNumber: 1 },
      { sessionId, speakerType: 'dm', message: 'The gate groans open.', sequenceNumber: 2 },
    ]);
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({
        sessionId,
        status: 'completed',
        endedReason: 'abandoned',
        currentRound: 2,
        currentTurnOrder: 0,
        version: 1,
      })
      .returning({ id: combatEncounters.id });
    return { campaignId, characterId, sessionId, encounterId };
  };

  const post = (path: string, headers: Record<string, string>, body = {}): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }),
    );

  const get = (path: string, headers: Record<string, string>): Promise<Response> =>
    pipeline.handle(new Request(`http://localhost${path}`, { headers }));

  const messageCount = async (sessionId: string): Promise<number> =>
    (
      await db
        .select({ id: dialogueHistory.id })
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId))
    ).length;

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('Resume session reopens the ended session with its messages, tracker and state; the fight stays closed (200)', async () => {
    const seeded = await seedAdventure({});
    const before = await messageCount(seeded.sessionId);
    expect(before).toBe(2);

    const response = await post(`/v1/sessions/${seeded.sessionId}/resume`, owner);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; status: string; end_time: unknown };
    expect(body.id).toBe(seeded.sessionId);
    expect(body.status).toBe('active');
    expect(body.end_time).toBeNull();

    const [row] = await db
      .select({
        status: gameSessions.status,
        sessionState: gameSessions.sessionState,
        summary: gameSessions.summary,
      })
      .from(gameSessions)
      .where(eq(gameSessions.id, seeded.sessionId));
    expect(row.status).toBe('active');
    expect(row.sessionState).toEqual(TRACKER);
    expect(row.summary).toBe('The party broke off the fight at the gate.');

    expect(await messageCount(seeded.sessionId)).toBe(before);

    const [encounter] = await db
      .select({ status: combatEncounters.status, endedReason: combatEncounters.endedReason })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, seeded.encounterId));
    expect(encounter.status).toBe('completed');
    expect(encounter.endedReason).toBe('abandoned');
  });

  it('Resume session is refused (409) while the hero already has an active session in this adventure', async () => {
    const seeded = await seedAdventure({});
    await db.insert(gameSessions).values({
      campaignId: seeded.campaignId,
      characterId: seeded.characterId,
      status: 'active',
      sessionNumber: 2,
    });
    const response = await post(`/v1/sessions/${seeded.sessionId}/resume`, owner);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { reason: string }).reason).toBe('already_active');
    const [row] = await db
      .select({ status: gameSessions.status })
      .from(gameSessions)
      .where(eq(gameSessions.id, seeded.sessionId));
    expect(row.status).toBe('completed');
  });

  it('Resume session is refused (409) for a fallen hero and for a finished one-shot', async () => {
    const fallen = await seedAdventure({ vitalState: 'dead' });
    const fallenResponse = await post(`/v1/sessions/${fallen.sessionId}/resume`, owner);
    expect(fallenResponse.status).toBe(409);
    expect(((await fallenResponse.json()) as { reason: string }).reason).toBe('fallen');

    const oneShot = await seedAdventure({ campaignLength: 'one-shot' });
    const oneShotResponse = await post(`/v1/sessions/${oneShot.sessionId}/resume`, owner);
    expect(oneShotResponse.status).toBe(409);
    expect(((await oneShotResponse.json()) as { reason: string }).reason).toBe('one_shot');
  });

  it('Resume session returns 404 to a user who does not own the session', async () => {
    const seeded = await seedAdventure({});
    const response = await post(`/v1/sessions/${seeded.sessionId}/resume`, stranger);
    expect(response.status).toBe(404);
    const [row] = await db
      .select({ status: gameSessions.status })
      .from(gameSessions)
      .where(eq(gameSessions.id, seeded.sessionId));
    expect(row.status).toBe('completed');
  });

  it('the resumable list shows the ended session, and leaves out a fallen hero and a one-shot', async () => {
    const resumable = await seedAdventure({});
    const fallen = await seedAdventure({ vitalState: 'dead' });
    const oneShot = await seedAdventure({ campaignLength: 'one-shot' });

    const list = await get(`/v1/sessions/resumable?campaign_id=${resumable.campaignId}`, owner);
    expect(list.status).toBe(200);
    const ids = ((await list.json()) as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toContain(resumable.sessionId);

    const fallenList = await get(`/v1/sessions/resumable?campaign_id=${fallen.campaignId}`, owner);
    expect(((await fallenList.json()) as unknown[]).length).toBe(0);
    const oneShotList = await get(
      `/v1/sessions/resumable?campaign_id=${oneShot.campaignId}`,
      owner,
    );
    expect(((await oneShotList.json()) as unknown[]).length).toBe(0);
  });

  it('Start new session makes a fresh session with no messages and leaves the ended one as it was', async () => {
    const seeded = await seedAdventure({});
    const response = await post('/v1/sessions', owner, {
      campaign_id: seeded.campaignId,
      character_id: seeded.characterId,
      status: 'active',
      session_number: 2,
      current_scene_description: 'The gate of Harrowmere.',
      turn_count: 0,
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; status: string };
    expect(created.id).not.toBe(seeded.sessionId);
    expect(created.status).toBe('active');
    expect(await messageCount(created.id)).toBe(0);

    const [old] = await db
      .select({ status: gameSessions.status, sessionState: gameSessions.sessionState })
      .from(gameSessions)
      .where(and(eq(gameSessions.id, seeded.sessionId)));
    expect(old.status).toBe('completed');
    expect(old.sessionState).toEqual(TRACKER);
  });
  it('two resumes of one hero at once: exactly one succeeds, the other is refused (409)', async () => {
    const first = await seedAdventure({});
    // A second ended session of the same hero in the same adventure.
    const [{ id: secondId }] = await db
      .insert(gameSessions)
      .values({
        campaignId: first.campaignId,
        characterId: first.characterId,
        status: 'completed',
        sessionNumber: 2,
        endTime: new Date(),
      })
      .returning({ id: gameSessions.id });

    const [a, b] = await Promise.all([
      post(`/v1/sessions/${first.sessionId}/resume`, owner),
      post(`/v1/sessions/${secondId}/resume`, owner),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const active = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.characterId, first.characterId),
          eq(gameSessions.status, 'active'),
        ),
      );
    expect(active.length).toBe(1);
  });

  it('the resumable list leaves out every session of a hero who has an active one', async () => {
    const seeded = await seedAdventure({});
    await db.insert(gameSessions).values({
      campaignId: seeded.campaignId,
      characterId: seeded.characterId,
      status: 'active',
      sessionNumber: 2,
    });
    const list = await get(`/v1/sessions/resumable?campaign_id=${seeded.campaignId}`, owner);
    expect(((await list.json()) as unknown[]).length).toBe(0);
  });

  it('the resumable list can be narrowed to one hero', async () => {
    const seeded = await seedAdventure({});
    const [{ id: otherHero }] = await db
      .insert(characters)
      .values({ userId: ownerId, campaignId: seeded.campaignId, name: testId('1669-other'), class: 'Rogue', level: 1 })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: otherHero,
      charisma: 8,
      maxHitPoints: 10,
      currentHitPoints: 10,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    await db.insert(gameSessions).values({
      campaignId: seeded.campaignId,
      characterId: otherHero,
      status: 'completed',
      sessionNumber: 1,
      endTime: new Date(),
    });
    const list = await get(
      `/v1/sessions/resumable?campaign_id=${seeded.campaignId}&character_id=${seeded.characterId}`,
      owner,
    );
    const rows = (await list.json()) as Array<{ id: string; character_id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].character_id).toBe(seeded.characterId);
  });
});
