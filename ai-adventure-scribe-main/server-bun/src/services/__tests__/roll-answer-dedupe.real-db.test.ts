import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db';
import { campaigns, dialogueHistory, gameSessions } from '../../../../db/schema';
import { transactionContext } from '../../../../db/transaction-context';
import {
  STORY_SAVE_ROLL,
  storyDmBody,
  storySaveAnswerBody,
} from '../../../../shared/test-fixtures/story-rolls';

if (hasRealDb) {
  const target = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL!);
  if (target.hostname !== '127.0.0.1' || target.port !== '55432')
    throw new Error('Refusing non-dedicated roll test database');
}
process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';
const authModule = await importWithRealDb(() => import('../../lib/auth'));
const { createRequestPipelineApp } = await importWithRealDb(() => import('../../http-pipeline'));
const { sessionMessageRoutes } = await importWithRealDb(
  () => import('../../routes/v1/session-messages'),
);
const { llmRoutes } = await importWithRealDb(() => import('../../routes/v1/llm'));
const { LLMProviderService } = await importWithRealDb(() => import('../llm-provider-service'));
const { sql } = await importWithRealDb(() => import('../../lib/db'));

describeWithDb('resolved narrative roll identity through real routes and PostgreSQL (#216)', () => {
  const database = hasRealDb ? realDb() : (null as unknown as ReturnType<typeof realDb>);
  const userId = testId('roll-dedupe-user');
  let campaignId: string;
  let sessionId: string;
  beforeAll(async () => {
    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('roll-dedupe') })
      .returning();
    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active' })
      .returning();
  });
  afterAll(async () => {
    await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    await sql`DELETE FROM ai_usage WHERE user_id = ${userId}`;
    await sql.end({ timeout: 5 });
    await closeRealDb();
  });

  const post = (path: string, body: unknown) =>
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const seed = async () => {
    const dm = storyDmBody(STORY_SAVE_ROLL);
    dm.id = crypto.randomUUID();
    dm.context.rollRequests = dm.context.rollRequests.map((r, i) => ({
      ...r,
      rollRequestId: `${dm.id}:roll:${i}`,
    }));
    const answer = storySaveAnswerBody(crypto.randomUUID(), new Date().toISOString());
    answer.context.rollRequestId = `${dm.id}:roll:0`;
    await database.insert(dialogueHistory).values({
      id: dm.id,
      sessionId,
      speakerType: 'dm',
      message: dm.message,
      context: dm.context,
    });
    return answer;
  };

  test('concurrent answer saves with different message ids return the first answer', async () => {
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: 'roll@example.test', plan: 'free' },
      error: null,
    } as never);
    try {
      const answer = await seed();
      const app = createRequestPipelineApp().use(sessionMessageRoutes);
      const responses = await Promise.all([
        app.handle(post(`/v1/sessions/${sessionId}/messages`, answer)),
        app.handle(
          post(`/v1/sessions/${sessionId}/messages`, { ...answer, id: crypto.randomUUID() }),
        ),
      ]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const bodies = await Promise.all(responses.map((r) => r.json()));
      expect(bodies[0].messages[0].id).toBe(bodies[1].messages[0].id);
      const rows = await database
        .select()
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'player')),
        );
      expect(
        rows.filter(
          (r) =>
            (r.context as Record<string, unknown>)?.rollRequestId === answer.context.rollRequestId,
        ),
      ).toHaveLength(1);
    } finally {
      auth.mockRestore();
    }
  });

  test('a withheld reply survives lost client persistence and replays one canonical DM id', async () => {
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: 'roll@example.test', plan: 'free' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify({
        text: 'The charm fails.',
        options: [],
        roll_requests: [],
        combat_transition: 'none',
        combatants: [],
        combat_actions: [],
      }),
      provider: 'openrouter',
      model: 't/m',
    } as never);
    const originalTimer = globalThis.setTimeout;
    const watchdogContexts: unknown[] = [];
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 120_000) watchdogContexts.push(transactionContext.getStore());
      return originalTimer(callback, delay, ...args);
    }) as typeof setTimeout);
    try {
      const answer = await seed();
      const app = createRequestPipelineApp().use(sessionMessageRoutes).use(llmRoutes);
      await app.handle(post(`/v1/sessions/${sessionId}/messages`, answer));
      const canonicalId = crypto.randomUUID();
      const request = (id: string) => ({
        prompt: 'Continue after the saving throw.',
        sessionId,
        player_input: answer.message,
        dmReply: {
          messageId: id,
          rollRequestId: answer.context.rollRequestId,
          inCombat: true,
          narrationGated: false,
        },
      });
      const first = await (await app.handle(post('/v1/llm/generate', request(canonicalId)))).json();
      expect(first.dmReplyPersisted).toBe(false);
      expect(watchdogContexts).toEqual([undefined]);
      const retry = await (
        await app.handle(post('/v1/llm/generate', request(crypto.randomUUID())))
      ).json();
      expect(retry).toEqual(first);
      expect(model).toHaveBeenCalledTimes(1);
      const save = storyDmBody({
        dmMessageId: retry.dmReplyMessageId,
        reply: { text: 'The charm fails.' },
        rollRequests: [],
      });
      await app.handle(post(`/v1/sessions/${sessionId}/messages`, save));
      await app.handle(post(`/v1/sessions/${sessionId}/messages`, save));
      const rows = await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.id, canonicalId));
      expect(rows).toHaveLength(1);
    } finally {
      timer.mockRestore();
      model.mockRestore();
      auth.mockRestore();
    }
  });

  test('overlapping generates wait for and replay the first committed turn', async () => {
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: 'roll@example.test', plan: 'free' },
      error: null,
    } as never);
    let started!: () => void;
    const generating = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const model = spyOn(LLMProviderService, 'generate').mockImplementation(async () => {
      started();
      await held;
      return {
        text: JSON.stringify({
          text: 'The charm fails.',
          options: [],
          roll_requests: [],
          combat_transition: 'none',
          combatants: [],
          combat_actions: [],
        }),
        provider: 'openrouter',
        model: 't/m',
      } as never;
    });
    try {
      const answer = await seed();
      const app = createRequestPipelineApp().use(sessionMessageRoutes).use(llmRoutes);
      await app.handle(post(`/v1/sessions/${sessionId}/messages`, answer));
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      const request = (messageId: string) => ({
        prompt: 'Continue after the resolved saving throw.',
        sessionId,
        player_input: answer.message,
        dmReply: {
          messageId,
          rollRequestId: answer.context.rollRequestId,
          inCombat: false,
          narrationGated: false,
        },
      });
      const first = app.handle(post('/v1/llm/generate', request(firstId)));
      await generating;
      const second = app.handle(post('/v1/llm/generate', request(secondId)));
      finish();
      const replies = await Promise.all([first, second]);
      expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
      const bodies = await Promise.all(replies.map((reply) => reply.json()));
      expect(bodies[1]).toEqual(bodies[0]);
      expect(model).toHaveBeenCalledTimes(1);
      const rows = await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId));
      expect(rows.filter((row) => row.id === firstId || row.id === secondId)).toHaveLength(1);
    } finally {
      finish();
      model.mockRestore();
      auth.mockRestore();
    }
  });

  test('a failed generation rolls back its claim and permits the same answer to Retry', async () => {
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: 'roll@example.test', plan: 'free' },
      error: null,
    } as never);
    let firstAttempt = true;
    const model = spyOn(LLMProviderService, 'generate').mockImplementation(async () => {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error('Provider disconnected');
      }
      return {
        text: JSON.stringify({
          text: 'The charm fails.',
          options: [],
          roll_requests: [],
          combat_transition: 'none',
          combatants: [],
          combat_actions: [],
        }),
        provider: 'openrouter',
        model: 't/m',
      } as never;
    });
    try {
      const answer = await seed();
      const app = createRequestPipelineApp().use(sessionMessageRoutes).use(llmRoutes);
      await app.handle(post(`/v1/sessions/${sessionId}/messages`, answer));
      const request = (id: string) => ({
        prompt: 'Continue after the saving throw.',
        sessionId,
        player_input: answer.message,
        dmReply: {
          messageId: id,
          rollRequestId: answer.context.rollRequestId,
          inCombat: false,
          narrationGated: false,
        },
      });
      const failedId = crypto.randomUUID();
      const retryId = crypto.randomUUID();
      expect((await app.handle(post('/v1/llm/generate', request(failedId)))).status).toBe(500);
      expect((await app.handle(post('/v1/llm/generate', request(retryId)))).status).toBe(200);
      expect(model).toHaveBeenCalledTimes(2);
      const rows = await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId));
      expect(rows.filter((row) => row.id === failedId || row.id === retryId)).toHaveLength(1);
    } finally {
      model.mockRestore();
      auth.mockRestore();
    }
  });

  test('submitting the same resolved roll twice starts exactly one DM turn row', async () => {
    const auth = spyOn(authModule, 'authenticateRequest').mockResolvedValue({
      user: { userId, email: 'roll@example.test', plan: 'free' },
      error: null,
    } as never);
    const model = spyOn(LLMProviderService, 'generate').mockResolvedValue({
      text: JSON.stringify({
        text: 'The charm fails.',
        options: [],
        roll_requests: [],
        combat_transition: 'none',
        combatants: [],
        combat_actions: [],
      }),
      provider: 'openrouter',
      model: 't/m',
    } as never);
    try {
      const answer = await seed();
      const app = createRequestPipelineApp().use(sessionMessageRoutes).use(llmRoutes);
      expect((await app.handle(post(`/v1/sessions/${sessionId}/messages`, answer))).status).toBe(
        200,
      );
      const request = (messageId: string) => ({
        prompt: 'Continue after the resolved saving throw.',
        sessionId,
        player_input: answer.message,
        requestType: 'user',
        dmReply: {
          messageId,
          inCombat: false,
          narrationGated: false,
          rollRequestId: answer.context.rollRequestId,
        },
      });
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      const first = await app.handle(post('/v1/llm/generate', request(firstId)));
      const second = await app.handle(post('/v1/llm/generate', request(secondId)));
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstBody = await first.json();
      expect(await second.json()).toEqual(firstBody);
      expect(firstBody.dmReplyMessageId).toBe(firstId);
      const withoutRollId = request(crypto.randomUUID());
      delete (withoutRollId.dmReply as { rollRequestId?: string }).rollRequestId;
      expect(await (await app.handle(post('/v1/llm/generate', withoutRollId))).json()).toEqual(
        firstBody,
      );
      const withoutReply = { ...request(crypto.randomUUID()), dmReply: undefined };
      expect(await (await app.handle(post('/v1/llm/generate', withoutReply))).json()).toEqual(
        firstBody,
      );
      const mismatch = request(crypto.randomUUID());
      mismatch.dmReply.rollRequestId = 'different-dm:roll:0';
      expect((await app.handle(post('/v1/llm/generate', mismatch))).status).toBe(409);
      expect(model).toHaveBeenCalledTimes(1);
      const rows = await database
        .select()
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId));
      expect(rows.filter((r) => r.id === firstId || r.id === secondId)).toHaveLength(1);
    } finally {
      model.mockRestore();
      auth.mockRestore();
    }
  });
});
