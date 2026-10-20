/**
 * #841: the corrective handout reprompt is a paid model call. It must be
 * bound to a DM reply the session owns and charged through AIUsageService
 * (llm_system): a quota check before the call, a charge after a usable
 * correction. At the quota limit (or without a bound DM reply) the refusal
 * degrades and no provider call is made.
 *
 * Real route, real applyDmHandoutActions, real schema parser, real guard and
 * registry; only auth, session ownership, the usage service (quota state),
 * the provider boundary and the journal DB are stubbed.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia, status } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://localhost/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'client_test',
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));
mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

// Chainable, awaitable stand-in for the drizzle client: every select resolves
// to no rows, so no authored handout is ever found. The insert returns one
// journal row with the fields entryFromRow reads.
const selectChain = (): Record<string, unknown> => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    then: (onFulfilled: (rows: unknown[]) => unknown, onRejected?: (error: unknown) => unknown) =>
      Promise.resolve([]).then(onFulfilled, onRejected),
  };
  return chain;
};
const insertedRows: Array<Record<string, unknown>> = [];
mock.module('../../../../../db/client', () => ({
  db: {
    select: () => selectChain(),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            id: 'journal-1',
            createdAt: new Date('2026-10-19T00:00:00.000Z'),
            ...values,
          };
          insertedRows.push(row);
          return [row];
        },
      }),
    }),
  },
}));

mock.module('../../../services/collaboration/room-manager.js', () => ({
  broadcastToRoom: () => {},
}));
mock.module('../../../services/dm/handout-ledger-service.js', () => ({
  recordHandoutPossessionFact: async () => {},
}));
mock.module('../combat/helpers.js', () => ({
  verifySessionOwnership: async () => ({ success: true, session: { id: 'session-1' } }),
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
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    },
  },
}));

const { createHandoutRoutes } = await import('../handouts.js');
const { recordDmTurnActions, __resetDmTurnActionRegistryForTests } = await import(
  '../../../services/dm/dm-turn-action-registry.js'
);

import type { HandoutRouteOptions } from '../handouts.js';

type UsageService = NonNullable<HandoutRouteOptions['usageService']>;

const testAuth = new Elysia({ name: 'test-841-handout-auth' }).resolve(
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
let chargeThrows = false;
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
    if (chargeThrows) throw new Error('charge failed');
    quotaConsumes.push(opts);
    return { allowed: true, remaining: Math.max(0, quotaRemaining - 1), resetAt: '', usageId: 1 };
  },
  recordProviderUsage: async (opts) => {
    providerUsage.push(opts);
    return 1;
  },
} as UsageService;

const sessionOwnership = (async () => ({
  success: true as const,
  session: {
    id: 'session-1',
    campaignId: 'campaign-1',
    starterCampaignId: null,
    characterId: null,
    sessionNumber: 1,
  },
})) as never as HandoutRouteOptions['sessionOwnership'];

const app = new Elysia().use(
  createHandoutRoutes({
    auth: testAuth as unknown as HandoutRouteOptions['auth'],
    sessionOwnership,
    usageService,
  }),
);

const postHandouts = (body: unknown): Request =>
  new Request('http://localhost/v1/sessions/session-1/handout-actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer valid-user-token' },
    body: JSON.stringify(body),
  });

/** An authored action whose key no campaign chunk carries: the audit's exploit shape. */
const unknownKeyAction = {
  mode: 'authored',
  key: 'not-a-real-key',
  title: 'Forged Letter',
  body: null,
  giver: 'Stranger',
};

const correctionResponse = JSON.stringify({
  text: '',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [
    { mode: 'improvised', key: null, title: 'Forged Letter', body: 'Meet at dusk.', giver: 'Stranger' },
  ],
  combatants: [],
  combat_actions: [],
});

beforeEach(() => {
  __resetDmTurnActionRegistryForTests();
  providerCalls.length = 0;
  quotaConsumes.length = 0;
  providerUsage.length = 0;
  insertedRows.length = 0;
  quotaRemaining = 0;
  usageStoreDown = false;
  chargeThrows = false;
  providerResponseText = correctionResponse;
});

describe('POST /v1/sessions/:id/handout-actions corrective call (#841)', () => {
  it('refuses the corrective call at the quota limit and makes no provider call', async () => {
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [unknownKeyAction],
      mapActions: [],
    });

    const response = await app.handle(
      postHandouts({ actions: [unknownKeyAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      entries: unknown[];
      degraded: Array<{ reason: string }>;
    };
    expect(payload.entries).toHaveLength(0);
    expect(payload.degraded).toHaveLength(1);
    expect(payload.degraded[0]!.reason).toBe('unknown_handout_key');
    expect(providerCalls).toHaveLength(0);
    expect(quotaConsumes).toHaveLength(0);
    expect(providerUsage).toHaveLength(0);
  });

  it('makes no provider call when the request names no DM reply, even with quota', async () => {
    quotaRemaining = 100;

    const response = await app.handle(postHandouts({ actions: [unknownKeyAction] }));

    expect(response.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
  });

  it('makes no provider call for a handout key the DM reply never used', async () => {
    quotaRemaining = 100;
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [{ ...unknownKeyAction, key: 'a-different-key' }],
      mapActions: [],
    });

    const response = await app.handle(
      postHandouts({ actions: [unknownKeyAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
  });

  it('corrects, charges llm_system once, and records provider usage on the happy path', async () => {
    quotaRemaining = 100;
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [unknownKeyAction],
      mapActions: [],
    });

    const response = await app.handle(
      postHandouts({ actions: [unknownKeyAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      entries: Array<{ title: string }>;
      degraded: unknown[];
    };
    expect(payload.degraded).toHaveLength(0);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]!.title).toBe('Forged Letter');
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
        inputTokens: 10,
        outputTokens: 20,
        sessionId: 'session-1',
      }),
    ]);
  });

  it('rejects an oversized action array before any provider call', async () => {
    quotaRemaining = 100;
    const actions = Array.from({ length: 11 }, () => unknownKeyAction);

    const response = await app.handle(postHandouts({ actions, dmReplyId: 'reply-1' }));

    expect(response.status).toBe(422);
    expect(providerCalls).toHaveLength(0);
  });

  it('makes no provider call when the DM reply belongs to another session', async () => {
    quotaRemaining = 100;
    recordDmTurnActions({
      sessionId: 'session-2',
      messageId: 'reply-1',
      handoutActions: [unknownKeyAction],
      mapActions: [],
    });

    const response = await app.handle(
      postHandouts({ actions: [unknownKeyAction], dmReplyId: 'reply-1' }),
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
      handoutActions: [unknownKeyAction],
      mapActions: [],
    });

    const response = await app.handle(
      postHandouts({ actions: [unknownKeyAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    expect(providerCalls).toHaveLength(0);
  });

  it('still returns the correction when the charge itself fails (never-throw)', async () => {
    quotaRemaining = 100;
    chargeThrows = true;
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [unknownKeyAction],
      mapActions: [],
    });

    const response = await app.handle(
      postHandouts({ actions: [unknownKeyAction], dmReplyId: 'reply-1' }),
    );

    expect(response.status).toBe(200);
    expect(providerCalls).toHaveLength(1);
  });

  it('does not 429 rapid action batches — they have their own bucket, not the llm generate bucket', async () => {
    quotaRemaining = 0; // degraded path: fast, and no provider calls to count
    recordDmTurnActions({
      sessionId: 'session-1',
      messageId: 'reply-1',
      handoutActions: [unknownKeyAction],
      mapActions: [],
    });

    const statuses: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const response = await app.handle(
        postHandouts({ actions: [unknownKeyAction], dmReplyId: 'reply-1' }),
      );
      statuses.push(response.status);
    }

    // The shared 'llm' bucket allows 10/min per free user: posts 11-15 would
    // 429 there. The dedicated 'dm-actions' bucket allows 60.
    expect(statuses).not.toContain(429);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
