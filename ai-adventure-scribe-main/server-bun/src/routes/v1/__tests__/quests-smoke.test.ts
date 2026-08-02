/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
/**
 * Smoke and boundary security checks for quests routes.
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
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => [] // By default, returning empty results for existing checks
        })
      })
    }),
    insert: () => ({
      values: () => ({
        returning: () => [{
          id: 'quest-1',
          campaignId: 'camp-1',
          title: 'Test Quest',
          description: 'A test description',
          questGiver: 'Giver',
          objectives: [],
          rewards: [],
          status: 'active',
          difficulty: 'medium',
          questType: 'side',
          locationId: null,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date()
        }],
      }),
    }),
  },
}));

// Mock CampaignService
mock.module('../../../services/campaign-service.js', () => {
  return {
    CampaignService: {
      getById: async (campaignId: string, userId: string) => {
        if (campaignId === 'owned-campaign-id' && userId === 'user-1') {
          return { id: 'owned-campaign-id', userId: 'user-1', name: 'Owned Campaign' };
        }
        return null;
      },
    },
  };
});

const { securedGameDataRoutes } = await import('../secured-game-data.js');

const app = new Elysia().use(securedGameDataRoutes);

describe('v1 quests routes API boundaries', () => {
  it('denies unauthenticated requests on quest creation', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/quests', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          campaign_id: 'owned-campaign-id',
          title: 'Quest',
        }),
      })
    );
    expect(response.status).toBe(401);
  });

  it('allows quest creation inside an owned campaign', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/quests', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          campaign_id: 'owned-campaign-id',
          title: 'Quest',
        }),
      })
    );
    expect(response.status).toBe(201);
    const json: any = await response.json();
    expect(json.id).toBe('quest-1');
  });

  it('rejects quest creation inside an unowned campaign with 404', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/quests', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          campaign_id: 'unowned-campaign-id',
          title: 'Quest',
        }),
      })
    );
    expect(response.status).toBe(404);
    const json: any = await response.json();
    expect(json.error).toBe('Not found');
  });

  it('allows quest upsert inside an owned campaign', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/quests/upsert', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          campaign_id: 'owned-campaign-id',
          title: 'Quest',
        }),
      })
    );
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json.id).toBe('quest-1');
  });

  it('rejects quest upsert inside an unowned campaign with 404', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/quests/upsert', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer valid-user-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          campaign_id: 'unowned-campaign-id',
          title: 'Quest',
        }),
      })
    );
    expect(response.status).toBe(404);
    const json: any = await response.json();
    expect(json.error).toBe('Not found');
  });
});
