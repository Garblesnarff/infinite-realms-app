/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
/**
 * Real-request boundary checks for sessions routes.
 * Independent of DATABASE_URL and external services.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// Mock env module first to satisfy validation
mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_API_KEY: 'test-api-key',
    WORKOS_CLIENT_ID: 'test-client-id',
  },
}));

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

// Mock database client
mock.module('../../../../../db/client', () => ({
  db: {
    transaction: async (cb: any) => cb({
      insert: () => ({
        values: () => ({
          returning: () => [{ id: 'chronicle-1' }],
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => [],
        }),
      }),
    }),
  },
}));

// Mock SessionService
mock.module('../../../services/session-service.js', () => {
  const mockSession = {
    id: 'valid-session-id',
    campaignId: 'camp-1',
    characterId: 'char-1',
    sessionNumber: 1,
    startTime: new Date(),
    endTime: null,
    status: 'active',
    currentSceneDescription: 'A dark cave',
    summary: 'The adventure begins',
    sessionNotes: '[]',
    turnCount: 0,
    sessionState: {},
    starterCampaignId: null,
    campaignVersion: 1,
    ruleset: 'dnd5e',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    SessionService: {
      createSession: async (data: any, userId: string) => {
        if (userId !== 'user-1') throw new Error('Unauthorized');
        return mockSession;
      },
      listSessions: async (filters: any, userId: string) => {
        if (userId !== 'user-1') return [];
        return [mockSession];
      },
      getSessionById: async (sessionId: string, userId: string) => {
        if (sessionId === 'valid-session-id' && userId === 'user-1') {
          return mockSession;
        }
        const err = new Error('Session not found');
        err.name = 'NotFoundError';
        throw err;
      },
      getSessionContext: async (sessionId: string, userId: string) => {
        if (sessionId === 'valid-session-id' && userId === 'user-1') {
          return {
            id: sessionId,
            campaignId: 'camp-1',
            characterId: 'char-1',
            campaign: { id: 'camp-1', name: 'Lost Mine' },
            character: { id: 'char-1', name: 'Gundren' },
          };
        }
        const err = new Error('Session not found');
        err.name = 'NotFoundError';
        throw err;
      },
      updateSession: async (sessionId: string, userId: string, data: any) => {
        if (sessionId === 'valid-session-id' && userId === 'user-1') {
          return { ...mockSession, ...data };
        }
        const err = new Error('Session not found');
        err.name = 'NotFoundError';
        throw err;
      },
      completeSession: async (sessionId: string, userId: string, summary?: string) => {
        if (sessionId === 'valid-session-id' && userId === 'user-1') {
          return { ...mockSession, status: 'completed', summary: summary || null };
        }
        const err = new Error('Session not found');
        err.name = 'NotFoundError';
        throw err;
      },
    },
  };
});

// Mock helpers
const helpersPath = import.meta.resolve('../combat/helpers.js');
mock.module(helpersPath, () => ({
  verifySessionOwnership: async () => ({ success: true }),
  verifyEncounterOwnership: async () => ({ success: true }),
}));

// Mock chronicle-generator
mock.module('../../../services/chronicle-generator.js', () => ({
  chronicleGenerator: {
    generateProChronicle: async () => ({
      chapterTitle: 'Chapter 1',
      previouslyOn: 'Previously...',
      chronicleText: 'A story...',
      illustrationPrompt: 'Draw a dragon...',
    }),
    generateIllustration: async () => 'https://example.com/art.png',
    generateShareToken: () => 'share-token-123',
  },
  persistChronicleFailure: async () => {},
}));

const { sessionsRoutes } = await import('../sessions.js');

const app = new Elysia().use(sessionsRoutes);

describe('v1 sessions routes API boundaries', () => {
  it('denies unauthenticated requests on fetch session', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id')
    );
    expect(response.status).toBe(401);
  });

  it('denies unauthorized session access on fetch session', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/invalid-session-id', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );
    expect(response.status).toBe(404);
  });

  it('successfully fetches session for authenticated and authorized requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.id).toBe('valid-session-id');
  });

  it('denies unauthorized session access on fetch session context', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/invalid-session-id/context', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );
    expect(response.status).toBe(404);
  });

  it('successfully fetches session context for authorized requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id/context', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.id).toBe('valid-session-id');
  });

  it('denies unauthorized session access on update session', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/invalid-session-id', {
        method: 'PATCH',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'active' }),
      })
    );
    expect(response.status).toBe(404);
  });

  it('successfully updates session for authorized requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id', {
        method: 'PATCH',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed' }),
      })
    );
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.status).toBe('completed');
  });

  it('denies unauthorized session access on complete session', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/invalid-session-id/complete', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ summary: 'Finished' }),
      })
    );
    expect(response.status).toBe(404);
  });

  it('successfully completes session for authorized requests', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id/complete', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ summary: 'Finished' }),
      })
    );
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.status).toBe('completed');
    expect(json.summary).toBe('Finished');
  });
});
