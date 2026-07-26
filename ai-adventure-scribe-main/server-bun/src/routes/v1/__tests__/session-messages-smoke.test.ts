/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Real-request boundary checks for session message routes.
 * Independent of DATABASE_URL and external services.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// Mock auth module
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

// Mock logger module
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

// Mock helpers for verification using absolute resolved path
const helpersPath = import.meta.resolve('../combat/helpers.js');
mock.module(helpersPath, () => ({
  verifySessionOwnership: async (sessionId: string, userId: string) => {
    if (sessionId === 'valid-session-id' && userId === 'user-1') {
      return { success: true, session: { id: 'valid-session-id', campaignId: 'camp-1', characterId: 'char-1' } };
    }
    return { success: false, error: { status: 404, message: 'Session not found' } };
  },
}));

// Mock SessionMessageService
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    getRecentMessages: async () => ({
      messages: [],
      hasMore: false,
      total: 0,
    }),
    addMessages: async () => [],
    messageExists: async () => true,
  },
}));

// Mock SessionService
mock.module('../../../services/session-service.js', () => ({
  SessionService: {
    getSessionById: async () => ({
      id: 'valid-session-id',
      campaignId: 'camp-1',
      characterId: 'char-1',
    }),
  },
}));

// Mock CharacterService
mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    getById: async () => ({
      id: 'char-1',
      name: 'Gundren',
      avatarUrl: 'https://example.com/avatar.png',
    }),
  },
}));

const { sessionMessageRoutes } = await import('../session-messages.js');

const app = new Elysia().use(sessionMessageRoutes);

describe('v1 session message routes API boundaries', () => {
  it('denies unauthenticated requests on fetch messages', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id/messages')
    );

    expect(response.status).toBe(401);
  });

  it('denies unauthorized session access on fetch messages', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/invalid-session-id/messages', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );

    expect(response.status).toBe(404);
  });

  it('successfully fetches messages for authenticated and authorized requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id/messages', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );

    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.messages).toBeDefined();
  });
});
