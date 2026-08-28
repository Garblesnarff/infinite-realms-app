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

// Mock logger module
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

// Mock helpers for verification using absolute resolved path
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
      new Request('http://localhost/v1/sessions/valid-session-id/messages'),
    );

    expect(response.status).toBe(401);
  });

  it('denies unauthorized session access on fetch messages', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/invalid-session-id/messages', {
        headers: {
          authorization: 'Bearer valid-user-token',
        },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('successfully fetches messages for authenticated and authorized requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id/messages', {
        headers: {
          authorization: 'Bearer valid-user-token',
        },
      }),
    );

    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.messages).toBeDefined();
  });

  it('rejects non-canonical speaker types on writes', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id/messages', {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ speaker_type: 'npc', message: 'should be rejected' }),
      }),
    );

    expect(response.status).toBe(422);
  });
});
