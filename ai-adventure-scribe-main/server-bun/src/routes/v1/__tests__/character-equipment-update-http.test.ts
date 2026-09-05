import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const getCharacter = mock(async (_characterId: string, userId: string) =>
  userId === 'user-1' ? { id: 'character-1', userId: 'user-1' } : null,
);
const updateCharacter = mock(async () => ({ id: 'character-1', name: 'Updated Hero' }));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'test-client-id',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization');
    if (token === 'Bearer owner-token') {
      return { user: { userId: 'user-1', email: 'owner@example.test', plan: 'free' }, error: null };
    }
    if (token === 'Bearer foreign-token') {
      return {
        user: { userId: 'user-2', email: 'foreign@example.test', plan: 'free' },
        error: null,
      };
    }
    return { user: null, error: 'Unauthorized' };
  },
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
    getById: getCharacter,
    update: updateCharacter,
  },
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {},
}));

const { charactersRoutes } = await import('../characters.js');
const app = new Elysia().use(charactersRoutes);

const requestFor = (token?: string): Request =>
  new Request('http://localhost/v1/characters/character-1', {
    method: 'PUT',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      equipment: [{ item_name: 'Longsword', item_type: 'weapon', quantity: 1, equipped: true }],
    }),
  });

describe('character equipment update route', () => {
  it('requires authentication', async () => {
    const response = await app.handle(requestFor());

    expect(response.status).toBe(401);
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-user equipment update', async () => {
    const response = await app.handle(requestFor('foreign-token'));

    expect(response.status).toBe(404);
    expect(updateCharacter).not.toHaveBeenCalled();
  });

  it('updates equipment through the authenticated owner path', async () => {
    const response = await app.handle(requestFor('owner-token'));

    expect(response.status).toBe(200);
    expect(updateCharacter).toHaveBeenCalledWith('character-1', 'user-1', expect.any(Object), [
      { item_name: 'Longsword', item_type: 'weapon', quantity: 1, equipped: true },
    ]);
  });
});
