import { beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  recklessAttackBody,
  recklessProposeBody,
} from '../../../../../shared/test-fixtures/reckless-attack-intent.js';

/** The shared action-bar proposal and commit bodies pass through the real intent route schema. */

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
let proposed: unknown = null;
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
  proposeCombatAttack: async (_id: string, intent: unknown) => {
    proposed = intent;
    return { legal: true };
  },
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

describe('POST /v1/combat/:encounterId/intent — reckless attack (#1635)', () => {
  beforeEach(() => {
    executed = [];
    proposed = null;
  });

  test('accepts the exact proposal body and forwards the flag', async () => {
    const res = await post(recklessProposeBody());
    expect(res.status).toBe(200);
    expect(proposed).toEqual(
      expect.objectContaining({
        type: 'attack',
        actorId: 'barbarian-1',
        targetId: 'orc-1',
        weaponId: 'longsword',
        reckless: true,
      }),
    );
  });

  test('accepts the exact reckless attack body and passes the reckless flag to the attack', async () => {
    const res = await post({ ...recklessAttackBody(), dmStartedAt: Date.now() });

    expect(res.status).toBe(200);
    expect(executed).toEqual([
      {
        intent: expect.objectContaining({
          type: 'attack',
          actorId: 'barbarian-1',
          targetId: 'orc-1',
          weaponId: 'longsword',
          reckless: true,
        }),
        source: 'dm',
      },
    ]);
  });
});
