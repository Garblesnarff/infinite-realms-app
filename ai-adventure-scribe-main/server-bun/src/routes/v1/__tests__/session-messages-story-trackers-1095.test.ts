/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1095 (Hark V-003): the client save whitelist dropped
 * context.storyTrackers, so the tracker line vanished on refetch/reload.
 * The fix changes what the client sends to POST /v1/sessions/:id/messages
 * (a new context key), so per AGENTS.md §4 this test sends that exact body
 * through the real route schema — a mocked API does not count. The route
 * accepts arbitrary context keys (t.Record(String, Unknown)); this pins
 * that the storyTrackers key survives validation and reaches storage.
 * Service layer mocked (same pattern as session-messages-smoke.test.ts);
 * the elysia route + schema under test are real.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer test-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/testdb',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

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

// Echo storage: returns rows shaped like DialogueHistory, so the response
// proves the context the route accepted — including storyTrackers.
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    getRecentMessages: async () => ({
      messages: [],
      hasMore: false,
      total: 0,
    }),
    addMessages: async (payload: Array<Record<string, any>>) =>
      payload.map((m, i) => ({
        id: m.id ?? `m-${i}`,
        sessionId: m.sessionId,
        speakerType: m.speakerType,
        speakerId: m.speakerId ?? null,
        message: m.message,
        context: m.context ?? null,
        images: m.images ?? null,
        sequenceNumber: i + 1,
        timestamp: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
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
    getById: async () => ({
      id: 'char-1',
      name: 'Gundren',
      avatarUrl: 'https://example.com/avatar.png',
    }),
  },
}));

const { sessionMessageRoutes } = await import('../session-messages.js');

const app = new Elysia().use(sessionMessageRoutes);

describe('v1 session messages storyTrackers (#1095)', () => {
  it('accepts a DM reply whose context carries storyTrackers and echoes it back', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/valid-session-id/messages', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: 'dm-2',
          speaker_type: 'dm',
          message: 'The clock ticks again.',
          context: {
            emotion: 'neutral',
            intent: 'response',
            combat_transition: 'none',
            storyTrackers: [{ name: 'Wall Clock', value: 2, limit: 6 }],
          },
          timestamp: new Date().toISOString(),
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      messages: Array<{ context: Record<string, any> }>;
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].context.storyTrackers).toEqual([
      { name: 'Wall Clock', value: 2, limit: 6 },
    ]);
  });
});
