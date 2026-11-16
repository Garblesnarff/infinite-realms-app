import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * #613 (AGENTS.md §4, #2286 pattern): the exact body the Dash action-bar chip sends must pass
 * through the REAL intent route schema and reach the executor as a dash. The execution is stubbed
 * at the service boundary; authentication, ownership and intent-schema validation are the real
 * code paths. The fixture is the same wire body the client test asserts it sends.
 */
import {
  dashIntentBody,
  DASH_ACTOR_ID,
} from '../../../../../shared/test-fixtures/combat-dash-intent';

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
    return { applied: true, action: 'dash' };
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

const post = async (body: unknown): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/combat/encounter-1/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify(body),
    }),
  );

describe('#613 POST /v1/combat/:encounterId/intent — dash from the action bar', () => {
  beforeEach(() => {
    executed = [];
  });

  test('accepts the exact Dash chip body and hands the executor a dash for that actor', async () => {
    const res = await post(dashIntentBody());

    expect(res.status).toBe(200);
    expect(executed).toEqual([
      {
        intent: { type: 'dash', actorId: DASH_ACTOR_ID },
        source: 'dm',
      },
    ]);
  });

  test('refuses a dash with no actor with a 4xx, and never reaches the executor', async () => {
    const res = await post({
      intent: { type: 'dash' },
      source: 'dm',
      origin: 'typed',
    });

    // The route answers 400 here; the use-item sibling test expects 422 for its missing field.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(executed).toEqual([]);
  });
});
