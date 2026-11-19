import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { offHandAttackBody } from '../../../../../shared/test-fixtures/off-hand-attack-intent.js';

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

describe('POST /v1/combat/:encounterId/intent — off-hand attack (#1639)', () => {
  beforeEach(() => {
    executed = [];
  });

  test('accepts the exact off-hand attack body and passes the off-hand flag to the attack', async () => {
    const res = await post({ ...offHandAttackBody(), dmStartedAt: Date.now() });

    expect(res.status).toBe(200);
    expect(executed).toEqual([
      {
        intent: expect.objectContaining({
          type: 'attack',
          actorId: 'fighter-1',
          targetId: 'orc-1',
          weaponId: 'dagger',
          offHand: true,
        }),
        source: 'dm',
      },
    ]);
  });
});
