/**
 * #1703 Part B: a one-shot session ended by hand (POST /v1/sessions/:id/complete with no
 * summary) must be offered through the two choices when the game URL is opened — never
 * silently replaced with session 2. Resume restores the same messages and clock value;
 * Start new session creates session 2; an engine-finished one-shot (non-empty summary)
 * remains non-resumable (409 one_shot).
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characterStats,
  characters,
  dialogueHistory,
  gameSessions,
  sessionTrackers,
} from '../../../../../db/schema/index';
import { isFinishedOneShotSession } from '../../../../../shared/one-shot-completion.js';
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

const ownerId = testId('1703-owner');
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const header = request.headers.get('authorization');
    if (header === 'Bearer 1703-owner-token') {
      return { user: { userId: ownerId, email: 'owner@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

const pipeline = await importWithRealDb(async () => {
  const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
  const { sessionsRoutes } = await import('../sessions.js');
  return createRequestPipelineApp().use(sessionsRoutes);
});

describeWithDb('One-shot ended by hand offers the two choices (#1703)', () => {
  let db: ReturnType<typeof realDb>;
  const owner = { authorization: 'Bearer 1703-owner-token', 'content-type': 'application/json' };

  const post = (path: string, body: Record<string, unknown> = {}): Promise<Response> =>
    pipeline.handle(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: owner,
        body: JSON.stringify(body),
      }),
    );

  const get = (path: string): Promise<Response> =>
    pipeline.handle(new Request(`http://localhost${path}`, { headers: owner }));

  const seedActiveOneShot = async () => {
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({
        userId: ownerId,
        name: testId('1703-oneshot'),
        campaignLength: 'one-shot',
      })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId: ownerId,
        campaignId,
        name: testId('1703-hero'),
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      charisma: 10,
      maxHitPoints: 12,
      currentHitPoints: 12,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        status: 'active',
        sessionNumber: 1,
        currentSceneDescription: 'Rain lashes the bell tower of Oakhaven.',
        turnCount: 6,
      })
      .returning({ id: gameSessions.id });
    await db.insert(dialogueHistory).values([
      {
        sessionId,
        speakerType: 'player',
        message: 'I inspect the cracked bell.',
        sequenceNumber: 1,
      },
      {
        sessionId,
        speakerType: 'dm',
        message: 'A faint chime answers from below.',
        sequenceNumber: 2,
      },
      {
        sessionId,
        speakerType: 'player',
        message: 'I descend the spiral stair.',
        sequenceNumber: 3,
      },
    ]);
    await db.insert(sessionTrackers).values({
      sessionId,
      name: 'Midnight Toll',
      value: 4,
      limit: 6,
    });
    return { campaignId, characterId, sessionId };
  };

  /**
   * Replays the exact HTTP sequence `use-session-initialization.ts` runs when a player opens
   * `/app/game/:campaignId?character=:characterId` (no session id, no continue flag).
   */
  const openGameUrl = async (campaignId: string, characterId: string) => {
    const listRes = await get(
      `/v1/sessions?campaign_id=${campaignId}&character_id=${characterId}&limit=5`,
    );
    expect(listRes.status).toBe(200);
    const sessions = (await listRes.json()) as Array<{
      id: string;
      status: string;
      session_number: number | null;
      current_scene_description: string | null;
    }>;

    const active = sessions.find((s) => s.status === 'active');
    if (active) return { state: 'active' as const, sessionId: active.id };

    const lastCompleted = sessions.find((s) => s.status === 'completed');
    if (!lastCompleted) throw new Error('Expected a completed session');

    const ctxRes = await get(`/v1/sessions/${lastCompleted.id}/context`);
    expect(ctxRes.status).toBe(200);
    const ctx = (await ctxRes.json()) as {
      status?: string | null;
      summary?: string | null;
      campaign?: { campaignLength?: string | null } | null;
      character?: { stats?: { vital_state?: string | null } | null } | null;
    };
    const isFallen = ctx.character?.stats?.vital_state === 'dead';
    if (isFallen) return { state: 'fallen' as const, sessionId: lastCompleted.id };

    const isCompletedOneShot = isFinishedOneShotSession({
      status: ctx.status,
      campaignLength: ctx.campaign?.campaignLength,
      summary: ctx.summary,
    });
    if (isCompletedOneShot)
      return { state: 'completed_one_shot' as const, sessionId: lastCompleted.id };

    const resumableRes = await get(
      `/v1/sessions/resumable?campaign_id=${campaignId}&character_id=${characterId}`,
    );
    expect(resumableRes.status).toBe(200);
    const resumable = (await resumableRes.json()) as Array<{ id: string }>;
    if (resumable.length > 0) {
      return { state: 'choosing' as const, resumableIds: resumable.map((r) => r.id) };
    }

    // All three checks empty -> silent continuation (the bug path in use-session-initialization.ts:380).
    const nextNumber = Math.max(...sessions.map((s) => s.session_number ?? 1)) + 1;
    const createRes = await post('/v1/sessions', {
      session_number: nextNumber,
      status: 'active',
      campaign_id: campaignId,
      character_id: characterId,
      turn_count: 0,
      current_scene_description: lastCompleted.current_scene_description ?? 'Continuing...',
      session_notes: `Continuing from Session ${lastCompleted.session_number ?? 1}`,
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    return { state: 'created_continuation' as const, sessionId: created.id };
  };

  const sessionCount = async (campaignId: string, characterId: string): Promise<number> =>
    (
      await db
        .select({ id: gameSessions.id })
        .from(gameSessions)
        .where(
          and(eq(gameSessions.campaignId, campaignId), eq(gameSessions.characterId, characterId)),
        )
    ).length;

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
  });

  afterAll(async () => {
    await closeRealDb();
  });

  it('End session in a one-shot -> open game URL: no session 2 until chosen; Resume restores messages and clock; Start new session creates session 2', async () => {
    const seeded = await seedActiveOneShot();

    // 1. Player clicks End session (POST /v1/sessions/:id/complete with no summary).
    const endRes = await post(`/v1/sessions/${seeded.sessionId}/complete`, {});
    expect(endRes.status).toBe(200);
    const ended = (await endRes.json()) as { status: string; summary: string | null };
    expect(ended.status).toBe('completed');
    expect(ended.summary).toBeNull();

    // 2. Player opens the game URL with no session id and no continue flag.
    const opened = await openGameUrl(seeded.campaignId, seeded.characterId);
    expect(opened.state).toBe('choosing');
    if (opened.state === 'choosing') {
      expect(opened.resumableIds).toEqual([seeded.sessionId]);
    }
    // No second session row was created before the player chose.
    expect(await sessionCount(seeded.campaignId, seeded.characterId)).toBe(1);

    // 3. Player chooses "Resume session": reopens session 1 with its messages and clock value intact.
    const resumeRes = await post(`/v1/sessions/${seeded.sessionId}/resume`, {});
    expect(resumeRes.status).toBe(200);
    const resumed = (await resumeRes.json()) as { id: string; status: string; end_time: unknown };
    expect(resumed.id).toBe(seeded.sessionId);
    expect(resumed.status).toBe('active');
    expect(resumed.end_time).toBeNull();
    expect(await sessionCount(seeded.campaignId, seeded.characterId)).toBe(1);

    const restoredMessages = await db
      .select({ speakerType: dialogueHistory.speakerType, message: dialogueHistory.message })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, seeded.sessionId));
    expect(restoredMessages.map((m) => m.message)).toEqual([
      'I inspect the cracked bell.',
      'A faint chime answers from below.',
      'I descend the spiral stair.',
    ]);

    const trackersRes = await get(`/v1/sessions/${seeded.sessionId}/trackers`);
    expect(trackersRes.status).toBe(200);
    const trackersBody = (await trackersRes.json()) as {
      trackers: Array<{ name: string; value: number; limit: number }>;
    };
    expect(trackersBody.trackers).toEqual([{ name: 'Midnight Toll', value: 4, limit: 6 }]);

    // 4. End session again, then choose "Start new session" (continue=1 -> POST /v1/sessions).
    const endAgainRes = await post(`/v1/sessions/${seeded.sessionId}/complete`, {});
    expect(endAgainRes.status).toBe(200);

    const createSession2Res = await post('/v1/sessions', {
      session_number: 2,
      status: 'active',
      campaign_id: seeded.campaignId,
      character_id: seeded.characterId,
      turn_count: 0,
      current_scene_description: 'Rain lashes the bell tower of Oakhaven.',
      session_notes: 'Continuing from Session 1',
    });
    expect(createSession2Res.status).toBe(201);
    const session2 = (await createSession2Res.json()) as {
      id: string;
      session_number: number;
      status: string;
    };
    expect(session2.id).not.toBe(seeded.sessionId);
    expect(session2.session_number).toBe(2);
    expect(session2.status).toBe('active');
    expect(await sessionCount(seeded.campaignId, seeded.characterId)).toBe(2);
  });

  it('a one-shot finished with a completion summary stays non-resumable (409 one_shot) and excluded from /resumable', async () => {
    const seeded = await seedActiveOneShot();

    // Engine finishes the one-shot with a completion summary.
    const finishRes = await post(`/v1/sessions/${seeded.sessionId}/complete`, {
      summary: 'The Midnight Toll struck six — the adventure ends.',
    });
    expect(finishRes.status).toBe(200);

    const resumableRes = await get(
      `/v1/sessions/resumable?campaign_id=${seeded.campaignId}&character_id=${seeded.characterId}`,
    );
    expect(resumableRes.status).toBe(200);
    expect(((await resumableRes.json()) as unknown[]).length).toBe(0);

    const resumeRes = await post(`/v1/sessions/${seeded.sessionId}/resume`, {});
    expect(resumeRes.status).toBe(409);
    expect(((await resumeRes.json()) as { reason: string }).reason).toBe('one_shot');

    // Opening the game URL restores the finished one-shot end state and creates no session 2.
    const opened = await openGameUrl(seeded.campaignId, seeded.characterId);
    expect(opened.state).toBe('completed_one_shot');
    expect(await sessionCount(seeded.campaignId, seeded.characterId)).toBe(1);
  });
});
