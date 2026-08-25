import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const upsertStats = mock(async (..._args: unknown[]) => undefined);

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
  authenticateRequest: async () => ({
    user: { userId: 'user-1', email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));

mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../../db/schema/index', () => ({
  spells: { id: 'id', name: 'name' },
}));
mock.module('../../../services/campaign-service.js', () => ({ CampaignService: {} }));
mock.module('../../../services/character/character-spell-service.js', () => ({
  CharacterSpellService: {},
}));
mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    getById: async () => ({ id: 'character-1' }),
    upsertStats,
  },
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {},
}));

const { charactersRoutes } = await import('../characters.js');
const app = new Elysia().use(charactersRoutes);

describe('character stats route payload boundary', () => {
  it('filters missing stat keys before calling the upsert service', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/characters/character-1/stats', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ strength: 18, current_hit_points: 7 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(upsertStats).toHaveBeenCalledWith('character-1', 'user-1', {
      strength: 18,
      currentHitPoints: 7,
    });
  });

  it('preserves a zero current HP value through the undefined-key filter', async () => {
    upsertStats.mockClear();

    const response = await app.handle(
      new Request('http://localhost/v1/characters/character-1/stats', {
        method: 'PUT',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ current_hit_points: 0 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(upsertStats).toHaveBeenCalledWith('character-1', 'user-1', {
      currentHitPoints: 0,
    });
  });
});
