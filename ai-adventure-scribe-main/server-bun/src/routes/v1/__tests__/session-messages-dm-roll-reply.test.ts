/**
 * #2280: the DM reply for a narrative-roll turn, posted exactly as the client posts it, through
 * the real request pipeline and the real `POST /v1/sessions/:id/messages` schema.
 *
 * #2250's tests mocked the API, so its text-less roll row passed every client test while the
 * route refused it (`message` has `minLength: 1`) on every narrative roll in production. Only
 * auth, ownership and the database service are stubbed here; the body is the shared fixture the
 * client's save-queue test asserts it sends.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  DECLINED_ROLL_BODY,
  DM_ROLL_REPLY_TURNS,
  TEXTLESS_PENDING_ROLL_BODY,
} from '../../../../../shared/test-fixtures/dm-roll-reply-saves';
import { storySaveAnswerBody } from '../../../../../shared/test-fixtures/story-rolls';

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-user-token'
      ? { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({
  logger: noopLogger,
  combatLogger: noopLogger,
  spellLogger: noopLogger,
  progressionLogger: noopLogger,
  errorLogSerializers: {},
  default: noopLogger,
}));

mock.module(import.meta.resolve('../combat/helpers.js'), () => ({
  verifySessionOwnership: async (sessionId: string, userId: string) =>
    sessionId === 'session-1' && userId === 'user-1'
      ? { success: true, session: { id: 'session-1', campaignId: 'camp-1', characterId: 'c-1' } }
      : { success: false, error: { status: 404, message: 'Session not found' } },
  verifyEncounterOwnership: async () => ({ success: true }),
}));

const saved: Array<Array<Record<string, unknown>>> = [];
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    getRecentMessages: async () => ({ messages: [], hasMore: false, total: 0 }),
    messageExists: async () => true,
    addMessages: async (messages: Array<Record<string, unknown>>) => {
      saved.push(messages);
      return messages.map((message, index) => ({
        ...message,
        speakerId: null,
        images: null,
        sequenceNumber: index + 1,
        timestamp: message.timestamp ?? new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
  },
}));
mock.module('../../../services/session-service.js', () => ({
  SessionService: { getSessionById: async () => ({ id: 'session-1', characterId: null }) },
}));
mock.module('../../../services/character-service.js', () => ({
  CharacterService: { getById: async () => null },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { sessionMessageRoutes } = await import('../session-messages.js');

// The production composition: the request pipeline (with its error handler) and then the routes.
const app = createRequestPipelineApp().use(sessionMessageRoutes);

const post = (body: unknown): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/sessions/session-1/messages', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/sessions/:id/messages — narrative roll replies (#2280)', () => {
  beforeEach(() => {
    saved.length = 0;
  });

  it('retains the exact client spell-save answer identity through the real route', async () => {
    const body = storySaveAnswerBody(
      '33333333-3333-4333-8333-333333333333',
      '2026-01-01T00:00:01.000Z',
    );
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(saved[0]?.[0]?.context).toEqual(body.context);
    expect(saved[0]?.[0]?.message).toBe(body.message);
    expect(saved[0]?.[0]?.id).toBe(body.id);
  });

  for (const turn of DM_ROLL_REPLY_TURNS) {
    it(`accepts the DM reply with its roll requests in context: ${turn.name}`, async () => {
      const response = await post(turn.wireBody);

      expect(response.status).toBe(200);
      expect(saved).toHaveLength(1);
      const [row] = saved[0] ?? [];
      // One row, under the turn's id, with the prose and the requests together.
      expect(row).toEqual(
        expect.objectContaining({
          id: turn.dmMessageId,
          sessionId: 'session-1',
          speakerType: 'dm',
          message: turn.reply.text,
        }),
      );
      expect(row?.context).toEqual(turn.wireBody.context);
    });
  }

  it("refuses #2250's text-less row, and says why instead of 'Internal Server Error'", async () => {
    const response = await post(TEXTLESS_PENDING_ROLL_BODY);

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error?: string;
      issues?: Array<{ path: string; message: string }>;
    };
    expect(body.error).toBe('Validation failed');
    expect(body.issues?.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain('Internal Server Error');
    // The refusal names the rule, never the submitted values.
    expect(JSON.stringify(body)).not.toContain('Insight check');
    expect(saved).toHaveLength(0);
  });

  it('#2291: accepts the declined-roll system line as one row with its intent', async () => {
    const response = await post(DECLINED_ROLL_BODY);

    expect(response.status).toBe(200);
    const [row] = saved[0] ?? [];
    expect(row).toEqual(
      expect.objectContaining({
        id: DECLINED_ROLL_BODY.id,
        speakerType: 'system',
        message: DECLINED_ROLL_BODY.message,
      }),
    );
    expect((row?.context as { intent?: unknown }).intent).toBe('roll_declined');
  });
});
