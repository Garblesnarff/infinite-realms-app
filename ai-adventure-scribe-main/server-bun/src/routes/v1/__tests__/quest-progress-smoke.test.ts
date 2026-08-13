import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

// Mock env
mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
  },
}));

// Mock logger
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

// Mock database client
mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../../../services/campaign-service.js', () => ({ CampaignService: {} }));

// We'll dynamically change what sql returns to simulate authorized/unauthorized states.
let mockQueryResults: any[] = [];
mock.module('../../../lib/db.js', () => ({
  sql: async (_strings: TemplateStringsArray, ..._values: any[]) => {
    return mockQueryResults;
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

const { securedGameDataRoutes } = await import('../secured-game-data.js');
const app = new Elysia().use(securedGameDataRoutes);

describe('v1 characters quest-progress security boundaries', () => {
  it('denies unauthenticated requests on quest progress', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/characters/char-1/quest-progress'),
    );
    expect(response.status).toBe(401);
  });

  it('rejects unauthorized or non-existent character with 404', async () => {
    // Simulation: query returns empty array (unauthorized/not found)
    mockQueryResults = [];

    const response = await app.handle(
      new Request('http://localhost/v1/characters/unowned-char-id/quest-progress', {
        headers: {
          authorization: 'Bearer valid-user-token',
        },
      }),
    );
    expect(response.status).toBe(404);
    const json: any = await response.json();
    expect(json.error).toBe('Character not found');
  });

  it('allows authorized access (user owns or has access to character)', async () => {
    const mockQuestProgress = [
      {
        status: 'active',
        updated_at: '2026-08-04T01:37:01.481Z',
        quests: { title: 'Slay the Dragon' },
      },
    ];

    let callCount = 0;
    mock.module('../../../lib/db.js', () => ({
      sql: async (_strings: TemplateStringsArray, ..._values: any[]) => {
        callCount++;
        if (callCount === 1) {
          // Authorization check: return a single row representing that the user is authorized.
          return [{ one: 1 }];
        }
        // Fetch progress check: return the mock progress
        return mockQuestProgress;
      },
    }));

    const response = await app.handle(
      new Request('http://localhost/v1/characters/owned-char-id/quest-progress', {
        headers: {
          authorization: 'Bearer valid-user-token',
        },
      }),
    );
    expect(response.status).toBe(200);
    const json: any = await response.json();
    expect(json).toEqual(mockQuestProgress);
  });
});
