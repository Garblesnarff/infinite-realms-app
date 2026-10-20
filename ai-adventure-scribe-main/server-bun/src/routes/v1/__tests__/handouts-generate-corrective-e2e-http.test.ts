/**
 * #841 (F02): end-to-end corrective-call proof through the real wiring.
 *
 * Drives POST /v1/llm/generate (production llmRoutes) and then
 * POST /v1/sessions/:id/handout-actions (production handoutRoutes) on one
 * createRequestPipelineApp() instance. The DM reply carries a handout key no
 * campaign chunk has (unknown_handout_key); the correction must be allowed
 * only because the generate response echoed the reply id the server
 * recorded, and the one llm_system charge must land after the usable
 * correction.
 *
 * Mocked: auth, provider boundary, session roll-turn path, AIUsageService
 * quota state, drizzle client, room manager, handout ledger fact. Real:
 * llmRoutes, handoutRoutes, corrective guard, DM action registry,
 * applyDmHandoutActions, parseDmResponse.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => noopLogger };

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
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    if (request.headers.get('authorization') === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  // The limiter is not under test here; the bucket behavior has its own
  // suite (handouts-corrective-quota-http.test.ts).
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../services/collaboration/room-manager.js', () => ({
  broadcastToRoom: () => {},
}));
mock.module('../../../services/dm/handout-ledger-service.js', () => ({
  recordHandoutPossessionFact: async () => {},
}));
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    // Ordinary (non-roll) turn: the unguarded branch, exactly as in
    // llm-generate-dm-reply-persistence.test.ts.
    withRollTurn: async (
      _sessionId: string,
      _userId: string,
      _playerInput: string | undefined,
      _rollId: string | undefined,
      _replyId: string | undefined,
      generate: () => Promise<unknown>,
    ) => generate(),
    addMessage: async (data: Record<string, unknown>) => ({ id: data.id }),
  },
}));

import {
  campaignChunks,
  campaignJournalEntries,
  characters,
  gameSessions,
} from '../../../../../db/schema/index.js';

// Table-keyed drizzle stand-in: ownership sees its joined row, authored
// handouts come from campaignChunks, journal inserts record what they got.
const selectRowsByTable = new Map<unknown, unknown[]>();
const insertedJournalRows: Array<Record<string, unknown>> = [];
const selectChain = () => {
  let table: unknown = null;
  const chain: Record<string, unknown> = {
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    then: (onFulfilled: (rows: unknown[]) => unknown, onRejected?: (error: unknown) => unknown) =>
      Promise.resolve(selectRowsByTable.get(table) ?? []).then(onFulfilled, onRejected),
  };
  return chain;
};
mock.module('../../../../../db/client', () => ({
  db: {
    select: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            id: 'journal-1',
            createdAt: new Date('2026-10-19T00:00:00.000Z'),
            ...values,
          };
          if (table === campaignJournalEntries) insertedJournalRows.push(row);
          return [row];
        },
      }),
    }),
  },
}));

const providerCalls: Array<Record<string, unknown>> = [];
const quotaConsumes: Array<Record<string, unknown>> = [];
const providerUsageRows: Array<Record<string, unknown>> = [];
let quotaRemaining = 500;
let generatedEnvelopeText = '';
let correctionEnvelopeText = '';

mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async (options: Record<string, unknown>) => {
      providerCalls.push(options);
      const text = providerCalls.length === 1 ? generatedEnvelopeText : correctionEnvelopeText;
      return {
        text,
        provider: 'openrouter',
        model: 'test-model',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    },
  },
}));

mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    assertUsageStoreAvailable: async () => {},
    getQuotaStatus: async (opts: Record<string, unknown>) => ({
      plan: 'free',
      limits: { daily: { llm: 15, llm_system: 500, image: 1, voice: 0 } },
      usage: 0,
      remaining: opts.type === 'llm_system' ? quotaRemaining : 10,
      resetAt: '2026-10-20T00:00:00.000Z',
    }),
    checkQuotaAndConsume: async (opts: Record<string, unknown>) => {
      quotaConsumes.push(opts);
      return { allowed: true, remaining: 499, resetAt: '', usageId: 1 };
    },
    refundQuota: async () => {},
    recordProviderUsage: async (opts: Record<string, unknown>) => {
      providerUsageRows.push(opts);
      return 1;
    },
    getAllQuotaStatuses: async () => ({ plan: 'free', quotas: {} }),
    deleteUsageRows: async () => ({ deleted: 0 }),
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { handoutRoutes } = await import('../handouts.js');
const { __resetDmTurnActionRegistryForTests } = await import(
  '../../../services/dm/dm-turn-action-registry.js'
);

const app = createRequestPipelineApp().use(llmRoutes).use(handoutRoutes);

const SESSION_ID = '175d1a5c-3e0b-4d2a-9f41-6c8e2b7a9d10';
const DM_MESSAGE_ID = '0b7e4f5a-2c9d-4e1b-8a3f-6d5c4b3a2e1f';
const PLAYER_INPUT = 'I take the sealed letter and read it.';

// The DM's turn: a contract-valid authored action whose key no campaign
// chunk carries — the F02 corrective shape (unknown_handout_key refusal at
// the route, after the contract pre-validation passes).
const dmHandoutAction = {
  mode: 'authored',
  key: 'wrong-key',
  title: 'Sealed Letter',
  body: null,
  giver: 'The Abbess',
};

const envelope = (handoutActions: unknown[]): string =>
  JSON.stringify({
    text: 'The abbess presses a sealed letter into your hand.',
    options: [],
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    scene_spec: null,
    map_actions: [],
    handout_actions: handoutActions,
    combatants: [],
    combat_actions: [],
  });

const correctionAction = {
  mode: 'improvised',
  key: null,
  title: 'Sealed Letter',
  body: 'The abbess presses a sealed letter into your hand. You may read it later.',
  giver: 'The Abbess',
};

beforeEach(() => {
  __resetDmTurnActionRegistryForTests();
  providerCalls.length = 0;
  quotaConsumes.length = 0;
  providerUsageRows.length = 0;
  insertedJournalRows.length = 0;
  quotaRemaining = 500;
  selectRowsByTable.clear();
  selectRowsByTable.set(gameSessions, [
    {
      session: {
        id: SESSION_ID,
        campaignId: 'campaign-1',
        starterCampaignId: null,
        characterId: null,
        sessionNumber: 1,
      },
      campaignOwnerId: 'user-1',
      characterUserId: null,
      characterOwnerId: null,
    },
  ]);
  selectRowsByTable.set(characters, []);
  selectRowsByTable.set(campaignChunks, []);
  generatedEnvelopeText = envelope([dmHandoutAction]);
  correctionEnvelopeText = envelope([correctionAction]);
});

describe('#841 end-to-end: generate -> bound corrective handout call', () => {
  it('echoes the reply id on the turn, then the bound corrective call fires, charges llm_system once, and delivers the handout', async () => {
    const generateResponse = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer valid-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: `The game state is authoritative.\n\n<player_input>\n${PLAYER_INPUT}\n</player_input>`,
          sessionId: SESSION_ID,
          player_input: PLAYER_INPUT,
          temperature: 0.9,
          maxTokens: 8192,
          requestType: 'user',
          dmReply: { messageId: DM_MESSAGE_ID, inCombat: false },
        }),
      }),
    );

    expect(generateResponse.status).toBe(200);
    const generated = (await generateResponse.json()) as Record<string, unknown>;
    // Without this echo, no current-client turn could ever bind a corrective
    // call: ordinary turns never take the roll-guarded path.
    expect(generated.dmReplyMessageId).toBe(DM_MESSAGE_ID);

    // The client posts the DM's actions back verbatim, with the reply id it
    // was just given (see user-data-api.ts wire-body test).
    const handoutsResponse = await app.handle(
      new Request(`http://localhost/v1/sessions/${SESSION_ID}/handout-actions`, {
        method: 'POST',
        headers: { authorization: 'Bearer valid-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          actions: [dmHandoutAction],
          dmReplyId: generated.dmReplyMessageId,
        }),
      }),
    );

    expect(handoutsResponse.status).toBe(200);
    const payload = (await handoutsResponse.json()) as {
      entries: Array<{ key: string | null; title: string }>;
      degraded: unknown[];
    };
    expect(payload.degraded).toHaveLength(0);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]!.title).toBe('Sealed Letter');
    expect(insertedJournalRows).toHaveLength(1);

    // One provider call for the turn, one for the correction — and only one.
    expect(providerCalls).toHaveLength(2);
    expect(String(providerCalls[1]?.prompt)).toContain('wrong-key');

    // The turn charged 'llm'; the correction charged 'llm_system' exactly once.
    expect(quotaConsumes).toContainEqual(expect.objectContaining({ type: 'llm', units: 1 }));
    expect(quotaConsumes).toContainEqual(
      expect.objectContaining({ type: 'llm_system', units: 1 }),
    );
    expect(providerUsageRows).toContainEqual(
      expect.objectContaining({
        type: 'llm_system',
        provider: 'openrouter',
        sessionId: SESSION_ID,
      }),
    );
  });

  it('refuses the corrective call when the quota is exhausted and makes no provider call', async () => {
    quotaRemaining = 0;

    const generateResponse = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer valid-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: `The game state is authoritative.\n\n<player_input>\n${PLAYER_INPUT}\n</player_input>`,
          sessionId: SESSION_ID,
          player_input: PLAYER_INPUT,
          temperature: 0.9,
          maxTokens: 8192,
          requestType: 'user',
          dmReply: { messageId: DM_MESSAGE_ID, inCombat: false },
        }),
      }),
    );
    const generated = (await generateResponse.json()) as Record<string, unknown>;

    const handoutsResponse = await app.handle(
      new Request(`http://localhost/v1/sessions/${SESSION_ID}/handout-actions`, {
        method: 'POST',
        headers: { authorization: 'Bearer valid-user-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          actions: [dmHandoutAction],
          dmReplyId: generated.dmReplyMessageId,
        }),
      }),
    );

    expect(handoutsResponse.status).toBe(200);
    const payload = (await handoutsResponse.json()) as {
      entries: unknown[];
      degraded: Array<{ reason: string }>;
    };
    expect(payload.entries).toHaveLength(0);
    expect(payload.degraded).toHaveLength(1);
    expect(payload.degraded[0]!.reason).toBe('unknown_handout_key');
    // The turn itself still happened; the corrective call never did.
    expect(providerCalls).toHaveLength(1);
    expect(quotaConsumes).not.toContainEqual(
      expect.objectContaining({ type: 'llm_system' }),
    );
  });
});
