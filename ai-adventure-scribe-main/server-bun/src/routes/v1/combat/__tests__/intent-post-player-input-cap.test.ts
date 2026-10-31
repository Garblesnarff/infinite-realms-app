/**
 * HTTP-level playerInput cap checks for POST /:encounterId/intent (#1307).
 *
 * The schema-level pin already lives in intent-schema.test.ts ("playerInput
 * length (#749)": 20_000 accepted, 20_001 refused). These tests drive the real
 * route: auth + ownership succeed, so an over-cap body must 422 from the
 * validator before any work happens, and an at-cap body must reach execution.
 * Independent of DATABASE_URL and external services: only the database-bound
 * leaves are faked, and they are never reached on the 422 path.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'user-1', email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));

mock.module('../../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

mock.module('../helpers.js', () => ({
  verifySessionOwnership: async () => ({ success: true }),
  verifyEncounterOwnership: async () => ({ success: true }),
}));

mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {},
}));

mock.module('../../../../services/combat/combat-intent-service.js', () => ({
  executeCombatIntent: async () => ({ engineRows: [] }),
  getLegalCombatActions: async () => ({ actions: [] }),
  proposeCombatAttack: async () => ({}),
}));

mock.module('../../../../services/combat/initiative-order.js', () => ({
  buildInitiativeOrder: async () => ({}),
}));

mock.module('../../../../services/combat/npc-turn-drain.js', () => ({
  runNpcTurnsIfNpcHolds: async () => null,
}));

mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
}));

const { intentRoutes } = await import('../intents.js');

const app = new Elysia().use(intentRoutes);

const postIntent = (body: unknown) =>
  app.handle(
    new Request('http://localhost/encounter-1/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('playerInput length cap on POST /:encounterId/intent (#1307)', () => {
  const endTurn = {
    source: 'player' as const,
    intent: { type: 'end_turn' as const, actorId: 'player-1' },
  };

  it('refuses a playerInput one character over the shared cap', async () => {
    const response = await postIntent({ ...endTurn, playerInput: 'a'.repeat(20_001) });

    expect(response.status).toBe(422);
  });

  it('accepts a playerInput exactly at the shared cap', async () => {
    const response = await postIntent({ ...endTurn, playerInput: 'a'.repeat(20_000) });

    expect(response.status).toBe(200);
  });
});
