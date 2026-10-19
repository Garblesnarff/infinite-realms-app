import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

/**
 * The player's own words for a combat turn, from the wire to the dispatch (#749).
 *
 * The route reads `playerInput` off the envelope and hands the raw string to `executeCombatIntent`
 * as its 7th argument. Only the modules the route reaches are faked, and the intent service is a
 * spy, so the assertions below pin the exact value the engine is handed rather than the turn it
 * would resolve.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ACTOR_ID = 'hero';

/** Every argument tuple `executeCombatIntent` was called with, in order. */
const executeCombatIntentCalls: unknown[][] = [];

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
  verifySessionOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
  verifyEncounterOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
}));
// The service record stays real; the one mutation gateway is a spy so its arguments can be
// inspected without a database.
mock.module('../../../../services/combat/combat-intent-service.js', () => ({
  executeCombatIntent: async (...args: unknown[]) => {
    executeCombatIntentCalls.push(args);
    return {};
  },
  getLegalCombatActions: async () => ({ actorId: null, version: 0, actions: [] }),
  proposeCombatAttack: async () => ({}),
}));
// The npc drain runs after the call; a no-op keeps the turn from depending on the board.
mock.module('../../../../services/combat/npc-turn-drain.js', () => ({
  runNpcTurnsIfNpcHolds: async () => undefined,
}));
// Reached at module load by the route's sibling GET handlers; faked so nothing touches the db.
mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => null,
    getActiveEncounter: async () => null,
    endCombat: async () => {},
  },
}));
mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
  loadLatestTacticalMapRow: async () => null,
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');

const app = createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes));

const postIntent = (body: unknown) =>
  app.handle(
    new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  executeCombatIntentCalls.length = 0;
});

describe('a combat turn’s playerInput through the real intent route', () => {
  it('passes the player’s words through untouched, not content-trimmed', async () => {
    const response = await postIntent({
      source: 'dm',
      intent: { type: 'flee', actorId: ACTOR_ID },
      origin: 'typed',
      playerInput: '  I step back.  ',
    });

    expect(response.status).toBe(200);
    expect(executeCombatIntentCalls).toHaveLength(1);
    // 7th argument: [0] encounterId, [1] intent, [2] userId, [3] source, [4] dmStartedAt,
    // [5] origin, [6] playerInput.
    expect(executeCombatIntentCalls[0][6]).toBe('  I step back.  ');
  });

  it('reads a whitespace-only playerInput as none', async () => {
    const response = await postIntent({
      source: 'dm',
      intent: { type: 'flee', actorId: ACTOR_ID },
      origin: 'typed',
      playerInput: '   ',
    });

    expect(response.status).toBe(200);
    expect(executeCombatIntentCalls).toHaveLength(1);
    expect(executeCombatIntentCalls[0][6]).toBeUndefined();
  });

  it('reads an absent playerInput as none', async () => {
    const response = await postIntent({
      source: 'dm',
      intent: { type: 'flee', actorId: ACTOR_ID },
      origin: 'typed',
    });

    expect(response.status).toBe(200);
    expect(executeCombatIntentCalls).toHaveLength(1);
    expect(executeCombatIntentCalls[0][6]).toBeUndefined();
  });

  it('refuses a non-string playerInput at the schema, before dispatch', async () => {
    const response = await postIntent({
      source: 'dm',
      intent: { type: 'flee', actorId: ACTOR_ID },
      origin: 'typed',
      playerInput: 123,
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'Invalid combat intent',
      stage: 'intent_schema',
      variant: 'flee',
    });
    expect(executeCombatIntentCalls).toHaveLength(0);
  });
});
