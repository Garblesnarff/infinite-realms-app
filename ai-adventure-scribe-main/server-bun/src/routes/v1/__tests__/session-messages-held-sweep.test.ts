/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1444: the session-load sweep, driven through the real GET /v1/sessions/:id/messages route.
 *
 * The sweep itself is the real expireStaleHeldReplies. Only the database client is replaced, by a
 * fake whose select records that it ran and can be made to fail. Two things are shown here:
 * the sweep runs before the messages are read, and a sweep that fails still returns the messages.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, error: () => {} };
let warnings: Record<string, unknown>[] = [];
const testLogger = {
  ...noopLogger,
  warn: (line: unknown) => {
    warnings.push(line as Record<string, unknown>);
  },
};

// Event order across the sweep and the message read.
let events: string[] = [];
// 'ok' lists no stale records; 'fail' makes the sweep's first query throw.
let sweepMode: 'ok' | 'fail' = 'ok';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '8895',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: testLogger }));

const helpersPath = import.meta.resolve('../combat/helpers.js');
mock.module(helpersPath, () => ({
  verifySessionOwnership: async (sessionId: string, userId: string) => {
    if (sessionId === 'valid-session-id' && userId === 'user-1') {
      return {
        success: true,
        session: { id: 'valid-session-id', campaignId: 'camp-1', characterId: 'char-1' },
      };
    }
    return { success: false, error: { status: 404, message: 'Session not found' } };
  },
  verifyEncounterOwnership: async () => ({ success: true }),
}));

const MESSAGE = {
  id: 'msg-1',
  sessionId: 'valid-session-id',
  speakerType: 'dm',
  speakerId: null,
  message: 'The cellar door creaks open.',
  context: {},
  images: null,
  sequenceNumber: 1,
  timestamp: new Date('2026-11-12T10:00:00.000Z'),
  createdAt: new Date('2026-11-12T10:00:00.000Z'),
  updatedAt: new Date('2026-11-12T10:00:00.000Z'),
};

mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    getRecentMessages: async () => {
      events.push('messages');
      return { messages: [MESSAGE], hasMore: false, total: 1 };
    },
    addMessages: async () => [],
    messageExists: async () => true,
  },
}));

mock.module('../../../services/session-service.js', () => ({
  SessionService: {
    getSessionById: async () => ({
      id: 'valid-session-id',
      campaignId: 'camp-1',
      characterId: 'char-1',
    }),
  },
}));

mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    getById: async () => ({ id: 'char-1', name: 'Gundren', avatarUrl: null }),
  },
}));

// The database client the sweep reaches through its dynamic import. A select records that the
// sweep ran; in 'fail' mode its query rejects, as a dropped connection would.
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => {
        events.push('sweep');
        if (sweepMode === 'fail') return Promise.reject(new Error('db unavailable'));
        return Promise.resolve([]);
      },
    }),
  }),
  update: () => ({
    set: () => ({
      where: () => ({
        returning: async () => [],
      }),
    }),
  }),
};
mock.module(import.meta.resolve('../../../../../db/client.js'), () => ({
  db: fakeDb,
  withNpcActionTransaction: async (_encounterId: string, work: () => Promise<unknown>) => work(),
  pgClient: {},
}));

const { sessionMessageRoutes } = await import('../session-messages.js');

const app = new Elysia().use(sessionMessageRoutes);

const getMessages = () =>
  app.handle(
    new Request('http://localhost/v1/sessions/valid-session-id/messages', {
      headers: { authorization: 'Bearer valid-user-token' },
    }),
  );

describe('#1444 session load runs the held-reply sweep before the messages', () => {
  beforeEach(() => {
    events = [];
    warnings = [];
    sweepMode = 'ok';
  });

  it('sweeps, then reads the messages, and returns them', async () => {
    const response = await getMessages();

    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.messages.map((m: any) => m.id)).toEqual(['msg-1']);
    expect(events).toEqual(['sweep', 'messages']);
    expect(warnings.filter((w) => w.msg === 'DM_REPLY_EXPIRY_FAILED')).toHaveLength(0);
  });

  it('a failing sweep is logged and the messages are still returned', async () => {
    sweepMode = 'fail';

    const response = await getMessages();

    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.messages.map((m: any) => m.id)).toEqual(['msg-1']);
    expect(events).toEqual(['sweep', 'messages']);
    expect(warnings).toEqual([
      expect.objectContaining({
        msg: 'DM_REPLY_EXPIRY_FAILED',
        sessionId: 'valid-session-id',
        error: 'db unavailable',
      }),
    ]);
  });
});
