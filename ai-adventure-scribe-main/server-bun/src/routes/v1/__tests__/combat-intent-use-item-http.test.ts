import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * #1147 (AGENTS.md §4, #2286 pattern): the exact body the client sends for a Use-item chip
 * must pass through the REAL route schema. The execution is stubbed at the service boundary;
 * authentication, ownership, and the intent-schema validation are the real code paths. A mocked
 * API does not count — #2250's tests mocked it, and the body they approved 422'd in production
 * (#2280).
 */

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, child: () => silentLogger };

mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: silentLogger,
  combatLogger: silentLogger,
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer test-token'
      ? { user: { userId: 'user-1', email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module('../combat/helpers.js', () => ({
  verifyEncounterOwnership: async () => ({ success: true }),
  verifySessionOwnership: async () => ({ success: true }),
}));

let executed: Array<{ intent: unknown; source: string }> = [];
mock.module('../../../services/combat/combat-intent-service.js', () => ({
  executeCombatIntent: async (
    _encounterId: string,
    intent: unknown,
    _userId: string,
    source: string,
  ) => {
    executed.push({ intent, source });
    return {
      applied: true,
      action: 'use_item',
      itemName: 'Potion of Healing',
      itemId: 'potion-1',
      healed: 9,
      newHp: 18,
      maxHp: 20,
      remainingQuantity: 1,
      itemDeleted: false,
    };
  },
  getLegalCombatActions: async () => ({ actions: [] }),
  proposeCombatAttack: async () => null,
}));
mock.module('../../../services/combat/npc-turn-drain.js', () => ({
  runNpcTurnsIfNpcHolds: async () => null,
}));
mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {},
}));
mock.module('../../../services/combat/initiative-order.js', () => ({
  buildInitiativeOrder: () => [],
}));
mock.module('../../../services/combat/pending-combat-entry.js', () => ({
  readPendingCombatEntry: async () => null,
}));
mock.module('../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { intentRoutes } = await import('../combat/intents.js');

// Production composition mounts intentRoutes under /v1/combat (combat/index.ts).
const app = createRequestPipelineApp().group('/v1/combat', (group) => group.use(intentRoutes));

const post = async (body: unknown) =>
  app.handle(
    new Request('http://localhost/v1/combat/encounter-1/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify(body),
    }),
  );

describe('POST /v1/combat/:encounterId/intent — use_item', () => {
  beforeEach(() => {
    executed = [];
  });

  test('accepts the exact body the client sends for a Use chip (dm source, no version)', async () => {
    const res = await post({
      intent: { type: 'use_item', actorId: 'player-1', itemId: 'potion-1' },
      source: 'dm',
      dmStartedAt: 1234567890,
      origin: 'typed',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { accepted: boolean };
    expect(json.accepted).toBe(true);
    expect(executed).toEqual([
      {
        intent: { type: 'use_item', actorId: 'player-1', itemId: 'potion-1' },
        source: 'dm',
      },
    ]);
  });

  test('accepts a player-source use_item carrying expectedVersion', async () => {
    const res = await post({
      intent: { type: 'use_item', actorId: 'player-1', itemId: 'potion-1', expectedVersion: 7 },
      source: 'player',
      origin: 'typed',
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as { accepted: boolean }).toEqual(
      expect.objectContaining({ accepted: true }),
    );
  });

  test('422s a use_item without itemId, and a player-source use_item without expectedVersion', async () => {
    const missingItem = await post({
      intent: { type: 'use_item', actorId: 'player-1' },
      source: 'dm',
      origin: 'typed',
    });
    expect(missingItem.status).toBe(422);

    const missingVersion = await post({
      intent: { type: 'use_item', actorId: 'player-1', itemId: 'potion-1' },
      source: 'player',
      origin: 'typed',
    });
    expect(missingVersion.status).toBe(422);
    expect(executed).toEqual([]);
  });
});
