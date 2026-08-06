import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_API_KEY: 'test-api-key',
    WORKOS_CLIENT_ID: 'test-client-id',
  },
}));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

const createdRow = {
  id: 'world-element-1',
  campaignId: 'owned-campaign-id',
  name: 'The Watcher',
  description: 'A quiet presence.',
  race: null,
  occupation: null,
  personality: null,
  backstory: null,
  relationship: null,
  location: null,
  imageUrl: null,
  voiceId: null,
  stats: null,
  locationType: 'point_of_interest',
  population: null,
  climate: null,
  terrain: null,
  notableFeatures: null,
  connectedLocations: null,
  mapUrl: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

mock.module('../../../../../db/client', () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: () => [createdRow],
      }),
    }),
  },
}));

mock.module('../../../services/campaign-service.js', () => ({
  CampaignService: {
    getById: async (campaignId: string, userId: string) =>
      campaignId === 'owned-campaign-id' && userId === 'user-1'
        ? { id: campaignId, userId, name: 'Owned campaign' }
        : null,
  },
}));

const { worldBuilderRoutes } = await import('../world-builder.js');
const app = new Elysia().use(worldBuilderRoutes);

describe('world-builder route boundaries', () => {
  it('denies unauthenticated NPC writes', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/world-builder/npcs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ campaign_id: 'owned-campaign-id', name: 'Blocked' }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it('allows an authenticated owner to create an NPC', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/world-builder/npcs', {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ campaign_id: 'owned-campaign-id', name: 'The Watcher' }),
      }),
    );

    expect(response.status).toBe(201);
    expect((await response.json()).id).toBe('world-element-1');
  });

  it('masks writes for an unowned campaign', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/world-builder/locations', {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ campaign_id: 'unowned-campaign-id', name: 'Secret place' }),
      }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('Not found');
  });
});
