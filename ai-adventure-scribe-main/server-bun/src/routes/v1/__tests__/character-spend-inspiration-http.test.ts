import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

/**
 * #1414: the client sends POST /v1/characters/:id/spend-inspiration with `{}` when a roll
 * consumes an armed Inspiration. This test posts the exact wire body through the real
 * Elysia route schema (AGENTS.md §4).
 */

const spendHolder = {
  result: { success: true, inspiration: false } as
    | { success: true; inspiration: false }
    | { success: false; reason: 'not_found' | 'no_inspiration' | 'forbidden' },
};
const spendInspiration = mock(async (..._args: unknown[]) => spendHolder.result);

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_API_KEY: 'test-key',
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
  characters: {},
  characterSpells: {},
  characterEquipment: {},
  inventoryItems: {},
  characterSpellSlots: {},
  spellSlotUsageLog: {},
  characterSubclasses: {},
}));
mock.module('../../../services/campaign-service.js', () => ({ CampaignService: {} }));
mock.module('../../../services/character/character-spell-service.js', () => ({
  CharacterSpellService: {},
}));
mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    getById: async () => ({ id: 'character-1' }),
    spendInspiration,
  },
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {},
}));
mock.module('../../../services/subclass-service.js', () => ({
  SubclassService: {
    getSubclassChoiceLevel: () => 3,
    setSubclass: async () => {},
  },
}));
mock.module('../../../services/combat/non-attack-damage.js', () => ({
  applyNonAttackDamage: mock(async () => ({
    vitals: { currentHitPoints: 22, temporaryHitPoints: 0 },
    engineLines: [],
  })),
}));

const { charactersRoutes } = await import('../characters.js');
const app = new Elysia().use(charactersRoutes);

const postSpend = (characterId = 'character-1'): Promise<Response> =>
  app.handle(
    new Request(`http://localhost/v1/characters/${characterId}/spend-inspiration`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }),
  );

describe('character spend-inspiration route wire body (#1414)', () => {
  it('accepts the exact {} body the client sends and routes it to spendInspiration', async () => {
    spendHolder.result = { success: true, inspiration: false };
    spendInspiration.mockClear();

    const response = await postSpend();

    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.inspiration).toBe(false);
    expect(spendInspiration).toHaveBeenCalledWith('character-1', 'user-1');
  });

  it('refuses an already-spent flag with 409 and the no_inspiration reason', async () => {
    spendHolder.result = { success: false, reason: 'no_inspiration' };

    const response = await postSpend();

    expect(response.status).toBe(409);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.reason).toBe('no_inspiration');
  });

  it('answers 404 for a character the caller does not own', async () => {
    spendHolder.result = { success: false, reason: 'not_found' };

    const response = await postSpend('character-9');

    expect(response.status).toBe(404);
    expect(spendInspiration).toHaveBeenCalledWith('character-9', 'user-1');
  });

  it('answers 403 for a view-only reader — a reader gets forbidden, not a 409 that claims the flag is gone (round 2)', async () => {
    spendHolder.result = { success: false, reason: 'forbidden' };

    const response = await postSpend();

    expect(response.status).toBe(403);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.reason).toBe('forbidden');
  });
});
