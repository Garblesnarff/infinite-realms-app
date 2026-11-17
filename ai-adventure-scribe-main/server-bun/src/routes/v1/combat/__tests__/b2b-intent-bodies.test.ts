/**
 * #621 B2b: the bodies the client now sends for the enemy attack, the action-bar dash, dodge,
 * hide, grapple and shove, and the Fighter's Second Wind, Action Surge and Divine Sense. Each body
 * is the shared fixture that the client test asserts the executor posts (AGENTS.md §4), and this
 * test posts exactly those bodies through the real intent route.
 *
 * The real route runs: the real request pipeline, the real `intentRoutes` handler, and the real
 * `combatIntentRequestValidator`. Only the database-bound services are faked: auth, encounter
 * ownership, and `executeCombatIntent`. The fake records the intent, source and origin the route
 * hands to dispatch, so the test checks what the server received.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  actionSurgeClientIntent,
  B2B_ENCOUNTER_ID,
  dashClientIntent,
  divineSenseClientIntent,
  dodgeClientIntent,
  enemyAttackWireBody,
  featureWireBody,
  grappleClientIntent,
  hideClientIntent,
  playerActionWireBody,
  secondWindClientIntent,
  shoveClientIntent,
} from '../../../../../../shared/test-fixtures/combat-b2b-intent-bodies';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';
process.env.PORT ??= '8893';
process.env.CORS_ORIGIN ??= 'http://localhost:8891';
process.env.WORKOS_API_KEY ??= 'test-workos-key';
process.env.WORKOS_CLIENT_ID ??= 'test-workos-client';
process.env.NODE_ENV ??= 'test';

const dispatched: Array<Record<string, unknown>> = [];

mock.module('../../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-token'
      ? { user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module(import.meta.resolve('../helpers.js'), () => ({
  verifySessionOwnership: async () => ({ success: true, session: { id: 'session-1' } }),
  verifyEncounterOwnership: async () => ({ success: true, session: { id: 'session-1' } }),
}));
mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => ({ encounter: null, participants: [] }),
    getActiveEncounter: async () => null,
    endCombat: async () => {},
  },
}));
// The database-bound dispatch. The route hands it the intent, source and origin it validated.
mock.module('../../../../services/combat/combat-intent-service.js', () => ({
  executeCombatIntent: async (
    encounterId: string,
    intent: unknown,
    _userId: string,
    source: string,
    dmStartedAt: number | undefined,
    origin: string | undefined,
  ) => {
    dispatched.push({ encounterId, intent, source, dmStartedAt, origin });
    return { accepted: true, encounter: { id: encounterId, version: 5 } };
  },
  getLegalCombatActions: async () => ({ actions: [] }),
  proposeCombatAttack: async () => ({}),
}));
mock.module('../../../../services/combat/npc-turn-drain.js', () => ({
  runNpcTurnsIfNpcHolds: async () => null,
}));
mock.module('../../../../services/combat/pending-combat-entry.js', () => ({
  readPendingCombatEntry: async () => null,
}));
mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
}));
mock.module('../../../../services/combat/health-condition.js', () => ({
  healthConditionForCombat: () => null,
}));
mock.module('../../../../services/combat/initiative-order.js', () => ({
  buildInitiativeOrder: () => [],
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');

const app = createRequestPipelineApp().use(intentRoutes);

const post = (body: unknown) =>
  app.handle(
    new Request(`http://localhost/${B2B_ENCOUNTER_ID}/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
      body: JSON.stringify(body),
    }),
  );

describe('#621 B2b: the bodies the client posts reach dispatch through the real route', () => {
  beforeEach(() => {
    dispatched.length = 0;
  });

  it.each([
    ['enemy attack (DM source)', enemyAttackWireBody],
    ['dash (player)', playerActionWireBody(dashClientIntent)],
    ['dodge (player)', playerActionWireBody(dodgeClientIntent)],
    ['hide (player check)', playerActionWireBody(hideClientIntent)],
    ['grapple (player check)', playerActionWireBody(grappleClientIntent)],
    ['shove (player check)', playerActionWireBody(shoveClientIntent)],
    ['second wind (DM panel body)', featureWireBody(secondWindClientIntent)],
    ['action surge (DM panel body)', featureWireBody(actionSurgeClientIntent)],
    ['divine sense (DM panel body)', featureWireBody(divineSenseClientIntent)],
  ])('accepts and dispatches %s with its intent, source and origin', async (_name, wire) => {
    const response = await post(wire);

    expect(response.status).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual({
      encounterId: B2B_ENCOUNTER_ID,
      intent: wire.intent,
      source: wire.source,
      dmStartedAt: undefined,
      origin: wire.origin,
    });
  });

  it('refuses a player action sent with no version, before dispatch', async () => {
    const response = await post({
      intent: dashClientIntent,
      source: 'player',
      origin: 'action_bar',
    });

    expect(response.status).toBe(422);
    expect(dispatched).toHaveLength(0);
  });
});
