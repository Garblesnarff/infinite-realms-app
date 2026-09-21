import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../../../db/client', () => ({ db: { select: () => ({ from: () => ({}) }) } }));
mock.module('../../../../../db/schema/index', () => ({
  campaignChunks: {},
  campaignJournalEntries: {},
  characters: {},
  gameSessions: {},
}));
mock.module('../combat/helpers.js', () => ({
  verifySessionOwnership: async () => ({ success: true, session: { id: 'session-1' } }),
}));
mock.module('../../../services/collaboration/room-manager.js', () => ({
  broadcastToRoom: () => {},
}));
mock.module('../../../services/dm/dm-response-schema.js', () => ({
  dmResponseSchema: {},
  parseDmResponse: () => ({ success: false, issues: [] }),
}));
mock.module('../../../services/dm/handout-action-service.js', () => ({
  applyDmHandoutActions: async () => ({ applied: [], degraded: [] }),
}));
mock.module('../../../services/dm/handout-ledger-service.js', () => ({
  recordHandoutPossessionFact: async () => {},
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: { generate: async () => ({ error: 'unused' }) },
}));
mock.module('../handout-route-helpers.js', () => ({
  authoredFromChunk: () => ({}),
  entryFromRow: () => ({}),
}));

const { handoutRoutes } = await import('../handouts.js');
const app = new Elysia().use(handoutRoutes);

describe('POST /v1/sessions/:id/handout-actions auth order', () => {
  it('no bearer and no body currently returns 422 (desired 401)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/handout-actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
    // Desired: 401. TypeBox body schema currently runs before requireAuth (#2120).
    expect(response.status).toBe(422);
  });
});
