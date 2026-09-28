import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug() {}, info() {}, warn() {}, error() {} },
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'user-1', email: 'user@example.test' },
    error: null,
  }),
}));
mock.module('../../../../../db/client.js', () => ({ db: {} }));
mock.module('../../../../../db/schema/index.js', () => ({
  campaignChunks: {},
  campaignJournalEntries: {},
  characters: {},
  gameSessions: {},
}));
mock.module('../combat/helpers.js', () => ({
  verifySessionOwnership: async () => ({
    success: true,
    session: {
      id: 'session-1',
      campaignId: 'campaign-1',
      starterCampaignId: null,
      characterId: null,
    },
  }),
}));
mock.module('../../../services/collaboration/room-manager.js', () => ({ broadcastToRoom() {} }));
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
  authoredFromChunk: () => null,
  entryFromRow: () => null,
}));

const { handoutRoutes } = await import('../handouts.js');
const app = new Elysia().use(handoutRoutes);

describe('POST /v1/sessions/:id/handout-actions schema contract', () => {
  it('accepts a complete authored action using the client request shape', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/handout-actions', {
        method: 'POST',
        headers: { authorization: 'Bearer valid-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          actions: [
            {
              mode: 'authored',
              key: 'alpha-journal',
              title: 'Alpha Journal',
              body: null,
              giver: 'Professor Darkwater',
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
  });

  it('rejects an action missing nullable schema fields', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/sessions/session-1/handout-actions', {
        method: 'POST',
        headers: { authorization: 'Bearer valid-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          actions: [
            { mode: 'authored', key: 'alpha-journal', title: 'Alpha Journal', giver: 'Darkwater' },
          ],
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'Invalid DM handout batch' });
  });
});
