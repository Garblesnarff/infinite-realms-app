/**
 * #2379: the opening scene, posted exactly as the client's save queue posts it, through the real
 * request pipeline and the real `POST /v1/sessions/:id/messages` schema.
 *
 * The route must accept the `initial_greeting` mark and hand it to the service intact: the
 * service's once-per-session check reads it from `context`, and a schema that stripped it would
 * turn that check off without failing anything else. The shared fixture is the body the client
 * test asserts the save queue sends. Only auth, ownership and the database service are stubbed;
 * the one-greeting outcome itself is `session-initial-greeting.real-db.test.ts`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  PREVIOUSLY_ON_IDS,
  PREVIOUSLY_ON_TEXT,
  previouslyOnWireBody,
} from '../../../../../shared/test-fixtures/continuation-session-init-save';
import {
  INITIAL_GREETING_IDS,
  INITIAL_GREETING_TEXT,
  initialGreetingWireBody,
} from '../../../../../shared/test-fixtures/initial-greeting-save';

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

describe('POST /v1/sessions/:id/messages — opening scene (#2379)', () => {
  beforeEach(() => {
    saved.length = 0;
  });

  it('accepts the greeting the client saves and passes its mark to the service', async () => {
    const response = await post(initialGreetingWireBody(INITIAL_GREETING_IDS[0]));

    expect(response.status).toBe(200);
    expect(saved).toHaveLength(1);
    const [row] = saved[0] ?? [];
    expect(row).toEqual(
      expect.objectContaining({
        id: INITIAL_GREETING_IDS[0],
        sessionId: 'session-1',
        speakerType: 'dm',
        message: INITIAL_GREETING_TEXT,
      }),
    );
    expect((row?.context as { initial_greeting?: unknown }).initial_greeting).toBe(true);
  });

  it('accepts the "Previously On" recap the client saves and passes its mark to the service (#2386)', async () => {
    const response = await post(previouslyOnWireBody(PREVIOUSLY_ON_IDS[0]));

    expect(response.status).toBe(200);
    expect(saved).toHaveLength(1);
    const [row] = saved[0] ?? [];
    expect(row).toEqual(
      expect.objectContaining({
        id: PREVIOUSLY_ON_IDS[0],
        sessionId: 'session-1',
        speakerType: 'dm',
        message: PREVIOUSLY_ON_TEXT,
      }),
    );
    expect((row?.context as { previously_on?: unknown }).previously_on).toBe(true);
  });
});
