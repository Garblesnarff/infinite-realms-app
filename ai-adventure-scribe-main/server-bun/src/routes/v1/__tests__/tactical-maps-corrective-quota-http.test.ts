/**
 * #841: the tactical-map dm-actions corrective reprompt is a paid model call.
 * It must be bound to a DM reply the session owns and charged through
 * AIUsageService (llm_system): a quota check before the call, a charge after
 * a usable correction. At the quota limit (or without a bound DM reply) the
 * refusal degrades and no provider call is made.
 *
 * Real route, real applyDmTacticalActions with the real engine dispatch and
 * a real map fixture; only auth, session ownership, the usage service (quota
 * state), the provider boundary and the map store (persistence) are stubbed,
 * at the route's and the service's own boundaries.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => noopLogger };

Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
});

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: noopLogger,
  combatLogger: noopLogger,
  spellLogger: noopLogger,
  progressionLogger: noopLogger,
  errorLogSerializers: {},
  default: noopLogger,
}));
mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: null, error: 'Unauthorized' }),
}));
mock.module('../../../lib/alerting.js', () => ({ alert: () => {} }));
mock.module('../../../services/collaboration/room-manager.js', () => ({
  broadcastToRoom: () => {},
}));
mock.module('../../../services/combat/combat-events.js', () => ({
  trackCombatEvent: () => {},
}));

// In-memory persistence boundary for the real tactical service: a 12x12
// all-floor board (the dispatch.test.ts fixture shape) with one goblin.
let storedMap: TacticalMap | null = null;
const freshMap = (): TacticalMap => ({
  id: 'map-1',
  sessionId: 'session-1',
  width: 12,
  height: 12,
  cells: Array.from({ length: 12 }, () =>
    Array.from({ length: 12 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'goblin-1',
      x: 5,
      y: 5,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
  round: 1,
  sceneDescription: 'A torch-lit vault.',
});
mock.module('../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => storedMap,
  loadLatestTacticalMapRow: async () => null,
  saveTacticalMap: async (map: TacticalMap) => {
    storedMap = map;
  },
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));

const providerCalls: Array<Record<string, unknown>> = [];
let providerResponseText = '';
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async (options: Record<string, unknown>) => {
      providerCalls.push(options);
      return {
        text: providerResponseText,
        provider: 'openrouter',
        model: 'test-model',
        usage: { inputTokens: 12, outputTokens: 24, totalTokens: 36 },
      };
    },
  },
}));

const { createTacticalMapRoutes } = await import('../tactical-maps.js');
const { recordDmTurnActions, __resetDmTurnActionRegistryForTests } = await import(
  '../../../services/dm/dm-turn-action-registry.js'
);

import type { TacticalMap } from '../../../tactical/types.js';
import type { TacticalMapRouteOptions } from '../tactical-maps.js';

type UsageService = NonNullable<TacticalMapRouteOptions['usageService']>;

const testAuth = new Elysia({ name: 'test-841-tactical-auth' }).resolve(
  { as: 'scoped' },
  ({ request }) => {
    if (request.headers.get('authorization') !== 'Bearer valid-user-token') {
      return status(401, { error: 'Unauthorized' });
    }
    return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' } };
  },
);

let quotaRemaining = 0;
let usageStoreDown = false;
const quotaConsumes: Array<Parameters<UsageService['checkQuotaAndConsume']>[0]> = [];
const providerUsage: Array<Parameters<UsageService['recordProviderUsage']>[0]> = [];

const usageService: UsageService = {
  assertUsageStoreAvailable: async () => {
    if (usageStoreDown) throw new Error('usage store unreachable');
  },
  getQuotaStatus: async () => ({
    plan: 'free',
    limits: { daily: { llm: 15, llm_system: 500, image: 1, voice: 0 } },
    usage: 0,
    remaining: quotaRemaining,
    resetAt: '2026-10-20T00:00:00.000Z',
  }),
  checkQuotaAndConsume: async (opts) => {
    quotaConsumes.push(opts);
    return { allowed: true, remaining: Math.max(0, quotaRemaining - 1), resetAt: '', usageId: 1 };
  },
  recordProviderUsage: async (opts) => {
    providerUsage.push(opts);
    return 1;
  },
} as UsageService;

// The refused action: the DM moved an entity that is not on the board
// (unknown_entity). The correction moves the real goblin one cell.
const refusedMoveAction = { action: 'move', entityId: 'ghost-1', x: 1, y: 1, changes: null };
const validMoveAction = { action: 'move', entityId: 'goblin-1', x: 6, y: 5, changes: null };

const correctionResponse = JSON.stringify({
  text: '',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [validMoveAction],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
});

const app = new Elysia().use(
  createTacticalMapRoutes({
    auth: testAuth as unknown as TacticalMapRouteOptions['auth'],
    sessionOwnership: (async () => ({ success: true })) as never,
    activeMapLoader: async () => storedMap,
    usageService,
  }),
);

const postDmActions = (body: unknown): Request =>
  new Request('http://localhost/v1/sessions/session-1/tactical-map/dm-actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer valid-user-token' },
    body: JSON.stringify(body),
  });

type DmActionsPayload = {
  results: Array<{ applied: boolean }>;
  degraded: Array<{ reason?: string }>;
};

beforeEach(() => {
  __resetDmTurnActionRegistryForTests();
  providerCalls.length = 0;
  quotaConsumes.length = 0;
  providerUsage.length = 0;
  quotaRemaining = 0;
  usageStoreDown = false;
  storedMap = freshMap();
  providerResponseText = correctionResponse;
});

describe('POST /v1/sessions/:id/tactical-map/dm-actions corrective call (#841)', () => {
  it('refuses the corrective call at the quota limit and makes no provider call', async () => {
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [],
      mapActions: [refusedMoveAction],
    });

    const response = await app.handle(
      postDmActions({ actions: [refusedMoveAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as DmActionsPayload;
    expect(payload.results[0]!.applied).toBe(false);
    expect(payload.degraded).toHaveLength(1);
    expect(providerCalls).toHaveLength(0);
    expect(quotaConsumes).toHaveLength(0);
    expect(providerUsage).toHaveLength(0);
  });

  it('makes no provider call when the DM reply had no map actions', async () => {
    quotaRemaining = 100;
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [{ mode: 'improvised', key: null, title: 'Note', body: 'x', giver: 'G' }],
      mapActions: [],
    });

    const response = await app.handle(
      postDmActions({ actions: [refusedMoveAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
  });

  it('makes no provider call when the DM reply belongs to another session', async () => {
    quotaRemaining = 100;
    recordDmTurnActions({
      sessionId: 'session-2',
      messageId: 'reply-1',
      handoutActions: [],
      mapActions: [refusedMoveAction],
    });

    const response = await app.handle(
      postDmActions({ actions: [refusedMoveAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
  });

  it('makes no provider call when the usage store is unavailable', async () => {
    quotaRemaining = 100;
    usageStoreDown = true;
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [],
      mapActions: [refusedMoveAction],
    });

    const response = await app.handle(
      postDmActions({ actions: [refusedMoveAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
  });

  it('corrects through the real engine, charges llm_system once, and records provider usage on the happy path', async () => {
    quotaRemaining = 100;
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [],
      mapActions: [refusedMoveAction],
    });

    const response = await app.handle(
      postDmActions({ actions: [refusedMoveAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as DmActionsPayload;
    expect(payload.results[0]!.applied).toBe(true);
    expect(payload.degraded).toHaveLength(0);
    // The real engine moved the goblin on the stored board.
    expect(storedMap?.entities[0]).toMatchObject({ id: 'goblin-1', x: 6, y: 5 });
    expect(providerCalls).toHaveLength(1);
    expect(quotaConsumes).toEqual([
      expect.objectContaining({ userId: 'user-1', type: 'llm_system', units: 1 }),
    ]);
    expect(providerUsage).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        type: 'llm_system',
        provider: 'openrouter',
        model: 'test-model',
        inputTokens: 12,
        outputTokens: 24,
        sessionId: 'session-1',
      }),
    ]);
  });

  it('rejects an oversized action array before any provider call', async () => {
    quotaRemaining = 100;
    const actions = Array.from({ length: 101 }, () => refusedMoveAction);

    const response = await app.handle(postDmActions({ actions, dmReplyId: 'reply-1' }));

    expect(response.status).toBe(422);
    expect(providerCalls).toHaveLength(0);
  });
});
