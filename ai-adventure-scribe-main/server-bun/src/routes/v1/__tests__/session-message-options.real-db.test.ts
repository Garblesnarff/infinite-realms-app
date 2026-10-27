import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { campaigns, dialogueHistory, gameSessions } from '../../../../../db/schema/index';
import { DM_OPTIONS_RELOAD } from '../../../../../shared/test-fixtures/dm-options-reload';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../../services/__tests__/fixtures/real-db';

let userId = '';
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId, email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));
if (hasRealDb) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  process.env.CORS_ORIGIN ??= 'http://localhost:5173';
  process.env.WORKOS_API_KEY ??= 'test-workos-key';
  process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
  process.env.PORT ??= '8888';
}

describeWithDb('#868 saved DM choices round trip through the real route and database', () => {
  let campaignId = '';
  let sessionId = '';
  let app: any;
  beforeAll(async () => {
    userId = testId('options-owner-868');
    [{ id: campaignId }] = await realDb()
      .insert(campaigns)
      .values({ userId, name: testId('options-campaign') })
      .returning({ id: campaigns.id });
    [{ id: sessionId }] = await realDb()
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const { createRequestPipelineApp, sessionMessageRoutes } = await importWithRealDb(async () => ({
      ...(await import('../../../http-pipeline')),
      ...(await import('../session-messages')),
    }));
    app = createRequestPipelineApp().use(sessionMessageRoutes);
  });
  afterAll(async () => {
    await realDb().delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await realDb().delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await realDb().delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });
  it('POSTs DM_OPTIONS_RELOAD, reads JSONB, then hydrates the same choices via GET', async () => {
    const response = await app.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DM_OPTIONS_RELOAD),
      }),
    );
    expect(response.status).toBe(200);
    const [row] = await realDb()
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, DM_OPTIONS_RELOAD.id));
    expect(row?.message).toBe(DM_OPTIONS_RELOAD.message);
    expect((row?.context as { actionOptions?: string[] } | null)?.actionOptions).toEqual(
      DM_OPTIONS_RELOAD.context.actionOptions,
    );
    const reloaded = await app.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/messages`),
    );
    expect(reloaded.status).toBe(200);
    const body = await reloaded.json();
    const saved = body.messages.find(
      (message: { id: string }) => message.id === DM_OPTIONS_RELOAD.id,
    );
    expect(saved.context.actionOptions).toEqual(DM_OPTIONS_RELOAD.context.actionOptions);
    expect(saved.message).toBe(DM_OPTIONS_RELOAD.message);
  });
});

describeWithDb('#1191 a completed session stays completed after the stale client PATCH', () => {
  let campaignId = '';
  let sessionId = '';
  let app: any;
  let completedEndTime: Date | null = null;
  beforeAll(async () => {
    userId = testId('completed-patch-1191-owner');
    [{ id: campaignId }] = await realDb()
      .insert(campaigns)
      .values({ userId, name: testId('completed-patch-1191-campaign') })
      .returning({ id: campaigns.id });
    [{ id: sessionId }] = await realDb()
      .insert(gameSessions)
      .values({
        campaignId,
        sessionNumber: 1,
        status: 'active',
        turnCount: 7,
        currentSceneDescription: 'Before the ending.',
      })
      .returning({ id: gameSessions.id });
    const { createRequestPipelineApp, sessionsRoutes, SessionService } =
      await importWithRealDb(async () => ({
        ...(await import('../../../http-pipeline')),
        ...(await import('../sessions')),
        ...(await import('../../../services/session-service.js')),
      }));
    app = createRequestPipelineApp().use(sessionsRoutes);
    // The real producer of the completed state: the engine's session_completed
    // path completes the session through SessionService.completeSession.
    const completed = await SessionService.completeSession(sessionId, userId, 'The ending.');
    completedEndTime = completed.endTime;
  });
  afterAll(async () => {
    await realDb().delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await realDb().delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });
  it('PATCHing status active with end_time null reads back completed with end_time set', async () => {
    // The exact stale-client save: the full `...prev` spread from a snapshot
    // taken before the ending landed (status active, end_time null), plus the
    // turn's own legitimate field updates.
    const response = await app.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'active',
          end_time: null,
          turn_count: 8,
          current_scene_description: 'After the ending.',
        }),
      }),
    );
    expect(response.status).toBe(200);
    const patched = await response.json();
    expect(patched.status).toBe('completed');
    expect(patched.end_time).not.toBeNull();
    const reloaded = await app.handle(new Request(`http://localhost/v1/sessions/${sessionId}`));
    expect(reloaded.status).toBe(200);
    const body = await reloaded.json();
    expect(body.status).toBe('completed');
    expect(body.end_time).not.toBeNull();
    const [row] = await realDb()
      .select()
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    expect(row?.status).toBe('completed');
    expect(row?.endTime).not.toBeNull();
    expect(row?.endTime?.getTime()).toBe(completedEndTime?.getTime());
    // The guard is surgical: the same PATCH's non-status fields still land.
    expect(row?.turnCount).toBe(8);
    expect(row?.currentSceneDescription).toBe('After the ending.');
  });
});

describeWithDb('#1095 storyTrackers round trip through the real route and database', () => {
  let campaignId = '';
  let sessionId = '';
  let app: any;
  beforeAll(async () => {
    userId = testId('story-trackers-1095-owner');
    [{ id: campaignId }] = await realDb()
      .insert(campaigns)
      .values({ userId, name: testId('story-trackers-campaign') })
      .returning({ id: campaigns.id });
    [{ id: sessionId }] = await realDb()
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
    const { createRequestPipelineApp, sessionMessageRoutes } = await importWithRealDb(async () => ({
      ...(await import('../../../http-pipeline')),
      ...(await import('../session-messages')),
    }));
    app = createRequestPipelineApp().use(sessionMessageRoutes);
  });
  afterAll(async () => {
    await realDb().delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await realDb().delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await realDb().delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });
  it('POSTs a DM reply with storyTrackers, reads JSONB, then hydrates the same line via GET', async () => {
    // The exact body the client save path sends after the #1095 fix: the
    // latch-shaped DM reply with its turn's clock line in context.
    const messageId = crypto.randomUUID();
    const body = {
      id: messageId,
      message: 'The clock ticks again.',
      speaker_type: 'dm' as const,
      timestamp: new Date().toISOString(),
      context: {
        emotion: 'neutral',
        intent: 'response',
        combat_transition: 'none',
        storyTrackers: [{ name: 'Wall Clock', value: 2, limit: 6 }],
      },
    };
    const response = await app.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(200);
    const [row] = await realDb()
      .select()
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, messageId));
    expect((row?.context as { storyTrackers?: unknown } | null)?.storyTrackers).toEqual([
      { name: 'Wall Clock', value: 2, limit: 6 },
    ]);
    const reloaded = await app.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/messages`),
    );
    expect(reloaded.status).toBe(200);
    const reloadedBody = await reloaded.json();
    const saved = reloadedBody.messages.find((message: { id: string }) => message.id === messageId);
    expect(saved.context.storyTrackers).toEqual([{ name: 'Wall Clock', value: 2, limit: 6 }]);
    expect(saved.message).toBe('The clock ticks again.');
  });
});
