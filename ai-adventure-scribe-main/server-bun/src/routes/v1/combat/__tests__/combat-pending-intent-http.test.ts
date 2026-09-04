import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

// The route module is imported for its own sake, so its transitive graph --
// lib/auth.js -> services/workos.ts (constructs a WorkOS client at module
// load) and the combat services -> db/client.ts (throws when DATABASE_URL is
// unset) -- must be replaced before it is evaluated. Under the fresh-process
// runner each test file gets its own module registry, so a static import here
// would be hoisted above these mocks and load the real graph. Hence the
// top-level `await import` below. Every one of these seams is also injected
// per-request through createPendingIntentRoutes; the mocks exist only to keep
// module evaluation side-effect free.
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: null, error: 'Unauthorized' }),
}));
mock.module('../../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));
// Every named export the route imports must exist here, or the module fails to link.
mock.module('../../../../services/combat/combat-pending-intent-service.js', () => ({
  setPendingCombatIntent: async () => {
    throw new Error('unstubbed setPendingCombatIntent');
  },
  clearPendingCombatIntent: async () => {
    throw new Error('unstubbed clearPendingCombatIntent');
  },
  promotePendingCombatIntent: async () => {
    throw new Error('unstubbed promotePendingCombatIntent');
  },
}));
mock.module('../../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {
    throw new Error('unstubbed publishCombatState');
  },
}));

const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ACTOR_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const TARGET_ID = 'cccccccc-dddd-4eee-8fff-000000000000';

const setCalls: unknown[][] = [];
const clearCalls: unknown[][] = [];
const promoteCalls: unknown[][] = [];
const publishCalls: unknown[][] = [];
const pendingIntent = {
  actorId: ACTOR_ID,
  actionType: 'attack',
  targetIds: [TARGET_ID],
  sourceText: 'I strike the Geometrist.',
  queuedOnTurn: 0,
  queuedOnRound: 2,
};

const authenticateRequest = async (request: Request) =>
  request.headers.get('x-test-user') === 'owner'
    ? { user: { userId: 'owner-1', email: 'owner@example.test', plan: 'free' }, error: null }
    : { user: null, error: 'Unauthorized' };

const setPendingCombatIntent = async (...args: unknown[]) => {
  setCalls.push(args);
  return pendingIntent;
};

const clearPendingCombatIntent = async (...args: unknown[]) => {
  clearCalls.push(args);
};

const promotePendingCombatIntent = async (...args: unknown[]) => {
  promoteCalls.push(args);
  return pendingIntent;
};

const publishCombatState = async (...args: unknown[]) => {
  publishCalls.push(args);
};

const { createPendingIntentRoutes } = await import('../pending-intent.js');

const app = new Elysia().use(
  createPendingIntentRoutes({
    authenticateRequest: authenticateRequest as never,
    setPendingCombatIntent: setPendingCombatIntent as never,
    clearPendingCombatIntent: clearPendingCombatIntent as never,
    promotePendingCombatIntent: promotePendingCombatIntent as never,
    publishCombatState: publishCombatState as never,
  }),
);

const request = (
  method: 'PATCH' | 'DELETE' | 'POST',
  body?: Record<string, unknown>,
  authenticated = true,
) =>
  app.handle(
    new Request(
      `http://localhost/${ENCOUNTER_ID}${method === 'POST' ? '/pending-intent/promote' : '/pending-intent'}`,
      {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(authenticated ? { 'x-test-user': 'owner' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    ),
  );

const validBody = () => ({
  actorId: ACTOR_ID,
  actionType: 'attack',
  targetIds: [TARGET_ID],
  sourceText: 'I strike the Geometrist.',
});

describe('PATCH /v1/combat/:encounterId/pending-intent', () => {
  beforeEach(() => {
    setCalls.splice(0);
    clearCalls.splice(0);
    promoteCalls.splice(0);
    publishCalls.splice(0);
  });

  it('requires authentication before accepting a declaration', async () => {
    const response = await request('PATCH', validBody(), false);

    expect(response.status).toBe(401);
    expect(setCalls).toHaveLength(0);
    expect(publishCalls).toHaveLength(0);
  });

  it('passes the declaration to the owned server service and publishes the result', async () => {
    const response = await request('PATCH', validBody());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pendingIntent });
    expect(setCalls).toEqual([[ENCOUNTER_ID, validBody(), 'owner-1']]);
    expect(publishCalls).toEqual([[ENCOUNTER_ID, 'owner-1', 'pending_intent_updated']]);
  });

  it('rejects a malformed declaration before the service runs', async () => {
    const response = await request('PATCH', { ...validBody(), targetIds: [''] });

    expect(response.status).toBe(422);
    expect(setCalls).toHaveLength(0);
  });

  it('clears a pending declaration through the authenticated route', async () => {
    const response = await request('DELETE');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pendingIntent: null });
    expect(clearCalls).toEqual([[ENCOUNTER_ID, 'owner-1']]);
    expect(publishCalls).toEqual([[ENCOUNTER_ID, 'owner-1', 'pending_intent_updated']]);
  });

  it('promotes a pending declaration through the authenticated route', async () => {
    const response = await request('POST');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pendingIntent });
    expect(promoteCalls).toEqual([[ENCOUNTER_ID, 'owner-1']]);
    expect(publishCalls).toEqual([[ENCOUNTER_ID, 'owner-1', 'pending_intent_updated']]);
  });
});
