import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { divineSmiteAttackBody } from '../../../../../shared/test-fixtures/divine-smite-attack-intent.js';

/**
 * #1362 (AGENTS.md §4, #2286 pattern): the exact body the action bar sends for Divine Smite
 * after a hit must pass through the REAL intent route schema and reach the attack resolution
 * with its slot level. Execution is stubbed at the service boundary; authentication, ownership
 * and the intent-schema validation are the real code paths. The slot spend and the damage are
 * covered by divine-smite.real-db.test.ts, which needs Postgres.
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
    return { applied: true, action: 'attack', hit: true, finalDamage: 9 };
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

describe('POST /v1/combat/:encounterId/intent — Divine Smite attack (#1362)', () => {
  beforeEach(() => {
    executed = [];
  });

  test('accepts the exact Smite attack body and passes the slot level to the attack', async () => {
    const res = await post(divineSmiteAttackBody(7));

    expect(res.status).toBe(200);
    expect(executed).toEqual([
      {
        intent: expect.objectContaining({
          type: 'attack',
          actorId: 'paladin-1',
          targetId: 'orc-1',
          expectedVersion: 7,
          divineSmiteSlotLevel: 1,
        }),
        source: 'player',
      },
    ]);
  });

  test('422s a Smite slot level outside 1-9 before anything runs', async () => {
    for (const divineSmiteSlotLevel of [0, 10]) {
      const res = await post({
        ...divineSmiteAttackBody(7),
        intent: { ...divineSmiteAttackBody(7).intent, divineSmiteSlotLevel },
      });
      expect(res.status).toBe(422);
    }
    expect(executed).toEqual([]);
  });
});
