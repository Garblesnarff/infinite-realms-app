/**
 * #1669 (strategist item 5): a session ended in a fight, then resumed, still hands the DM the
 * "abandoned mid-fight" note on the first turn after the resume. Runs the real End route
 * (POST /v1/sessions/:id/complete), the real resume route (POST /v1/sessions/:id/resume) and the
 * real next-turn read (GET /v1/sessions/:id/tactical-map/context/:entityId) against the real
 * database. Only authentication is faked. Runs only in the real-DB CI job (TEST_DATABASE_URL);
 * never against a shared database.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipants,
  gameSessions,
  tacticalMaps,
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

const noteUserId = testId('1669-note-user');
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer 1669-note-token'
      ? { user: { userId: noteUserId, email: 'note@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { sessionsRoutes } = await import('../sessions.js');
  const { createTacticalMapRoutes } = await import('../tactical-maps.js');
  return createRequestPipelineApp().use(sessionsRoutes).use(createTacticalMapRoutes());
});

/** The fact the engine writes when a fight is walked away from (combat-ending describeCombatEnd). */
const ABANDONED_NOTE = 'this encounter was abandoned mid-fight';

describeWithDb('a fight ended, then resumed: the DM note still reaches the next turn (#1669)', () => {
  let db: ReturnType<typeof realDb>;
  const auth = { authorization: 'Bearer 1669-note-token', 'content-type': 'application/json' };

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
  });

  afterAll(async () => {
    await closeRealDb();
  });

  /** A session with one open fight and an active tactical board, the way a live fight stands. */
  const seedFight = async () => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: noteUserId, name: testId('1669-note-camp') })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId: noteUserId,
        campaignId,
        name: testId('1669-note-hero'),
        class: 'Fighter',
        level: 3,
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      charisma: 8,
      maxHitPoints: 24,
      currentHitPoints: 20,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });
    await db.insert(combatParticipants).values({
      encounterId,
      characterId,
      name: 'Test Fighter',
      participantType: 'player',
      turnOrder: 0,
      initiative: 12,
      maxHp: 24,
    });
    await db.insert(tacticalMaps).values({
      sessionId,
      active: true,
      state: {
        id: crypto.randomUUID(),
        sessionId,
        width: 4,
        height: 4,
        round: 1,
        sceneDescription: 'A test glade.',
        cells: Array.from({ length: 4 }, () =>
          Array.from({ length: 4 }, () => ({
            terrain: 'floor',
            blocksMovement: false,
            blocksSight: false,
            cover: 0,
            elevation: 0,
          })),
        ),
        entities: [
          {
            id: 'hero-1',
            slug: 'hero',
            x: 1,
            y: 1,
            size: 'medium',
            type: 'pc',
            speedFeet: 30,
            movementRemaining: 30,
          },
        ],
      } as never,
    });
    return { sessionId, campaignId };
  };

  const post = (path: string, body: object = {}): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify(body),
      }),
    );

  it('End in a fight, resume, and the first next-turn read carries the abandoned-fight note', async () => {
    const { sessionId } = await seedFight();

    const ended = await post(`/v1/sessions/${sessionId}/complete`);
    expect(ended.status).toBe(200);

    const resumed = await post(`/v1/sessions/${sessionId}/resume`);
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { status: string }).status).toBe('active');

    const turn = await pipeline.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/tactical-map/context/hero-1`, {
        headers: { authorization: auth.authorization },
      }),
    );
    expect(turn.status).toBe(200);
    const body = (await turn.json()) as { tacticalContext?: string };
    expect(body.tacticalContext ?? '').toContain(ABANDONED_NOTE);

    // The fight itself stays closed: the encounter is still completed, and nothing re-opened it.
    const [encounter] = await db
      .select({ status: combatEncounters.status, endedReason: combatEncounters.endedReason })
      .from(combatEncounters)
      .where(eq(combatEncounters.sessionId, sessionId));
    expect(encounter.status).toBe('completed');
    expect(encounter.endedReason).toBe('abandoned');
  });
});
