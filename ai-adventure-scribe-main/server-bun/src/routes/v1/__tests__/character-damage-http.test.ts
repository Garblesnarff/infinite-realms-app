import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

/**
 * #621 Part A: the client now sends POST /v1/characters/:id/damage with
 * `{amount}` from the in-combat path too (previously no request was sent in
 * combat). This test posts the exact wire body through the real Elysia route
 * schema (AGENTS.md §4).
 */

const applyNonAttackDamage = mock(
  async (..._args: unknown[]) => ({
    vitals: { currentHitPoints: 22, temporaryHitPoints: 0 },
    engineLines: [],
  }),
);

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
  CharacterService: { getById: async () => ({ id: 'character-1' }) },
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {},
}));
mock.module('../../../services/combat/non-attack-damage.js', () => ({
  applyNonAttackDamage,
}));

const { charactersRoutes } = await import('../characters.js');
const app = new Elysia().use(charactersRoutes);

describe('character damage route wire body (#621)', () => {
  it('accepts the exact {amount} body the client sends and routes it to applyNonAttackDamage', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/characters/character-1/damage', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ amount: 8 }),
      }),
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json.currentHitPoints).toBe(22);
    expect(applyNonAttackDamage).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      8,
      'damage_taken',
      { critical: false, damageType: undefined },
    );
  });

  it('forwards damageType to applyNonAttackDamage when the client sends it', async () => {
    applyNonAttackDamage.mockClear();

    const response = await app.handle(
      new Request('http://localhost/v1/characters/character-1/damage', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ amount: 8, damageType: 'fire' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(applyNonAttackDamage).toHaveBeenCalledWith(
      'character-1',
      'user-1',
      8,
      'damage_taken',
      { critical: false, damageType: 'fire' },
    );
  });

  it('rejects a negative amount at the schema boundary', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/characters/character-1/damage', {
        method: 'POST',
        headers: {
          authorization: 'Bearer test-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ amount: -5 }),
      }),
    );

    expect(response.status).toBe(422);
  });
});
