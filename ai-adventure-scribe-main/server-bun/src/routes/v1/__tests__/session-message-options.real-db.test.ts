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
