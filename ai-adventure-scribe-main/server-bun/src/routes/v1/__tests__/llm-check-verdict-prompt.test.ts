import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

/**
 * #1477 item 1: the DM prompt reads the server's verdict for a narrative check, not the client's
 * word. The client sends its formatter line in `history`; the server's saved row carries the
 * verdict. The real `POST /v1/llm/generate` route runs; only the provider, auth, quota, logging and
 * the persistence read are stubbed. No live DM is called.
 */

import { ABILITY_CHECK_ROW_FAIL } from '../../../../../shared/test-fixtures/ability-check-saves';

type CapturedInput = Record<string, unknown>;
type SavedCheck = { rollRequestId: string; message: string; verdict: 'SUCCESS' | 'FAIL' };

let generatedInputs: CapturedInput[] = [];
// The session's saved check rows, newest first. The stub returns them all; the route's matcher
// must pick by roll request id, not by the first row that looks the same.
let savedChecks: SavedCheck[] = [];
let lookupCalls = 0;
let warnings: Array<Record<string, unknown>> = [];

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (line: unknown) => {
    if (line && typeof line === 'object') warnings.push(line as Record<string, unknown>);
  },
  error: () => {},
  child: () => testLogger,
};

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'verdict-user', email: 'verdict@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../../middleware/admin.js', () => ({ isAdmin: () => false }));
mock.module('../../../middleware/rate-limit.js', () => ({
  planRateLimit: () => new Elysia({ name: 'test-plan-rate-limit' }),
}));
mock.module('../../../lib/user-plan.js', () => ({
  resolveUserPlanStrict: async () => 'free',
}));
mock.module('../../../services/ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: async () => ({
      allowed: true,
      remaining: 99,
      resetAt: new Date(Date.now() + 60_000),
    }),
    recordProviderUsage: async () => {},
  },
}));
mock.module('../../../services/llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: async (input: CapturedInput) => {
      generatedInputs.push(input);
      return {
        text: 'You haul yourself over the ledge. What do you do?',
        provider: 'openrouter',
        model: 'test/model',
      };
    },
  },
}));
mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    withRollTurn: async (
      _sessionId: string,
      _userId: string,
      _playerInput: string | undefined,
      _rollId: string | undefined,
      _replyId: string | undefined,
      generate: () => Promise<unknown>,
    ) => generate(),
    serverCheckRowsForRequest: async () => {
      lookupCalls += 1;
      return savedChecks;
    },
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

// Two rolls with the same label and total (Athletics 12), against different DCs.
// The row for the easier DC (10) saved SUCCESS; the row for DC 15 saved FAIL.
const EASY_ROLL = 'roll-easy-dc10';
const HARD_ROLL = 'roll-hard-dc15';
const TWELVE_SUCCESS = 'Athletics check: 12 (nat 7+5) success';
const TWELVE_FAIL = 'Athletics check: 12 (nat 7+5) fail';
const TWELVE_CLIENT_SUCCESS = 'Athletics check: 12 (nat 7+5) success';

const postTurn = (
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  playerInput: string,
  dmReply?: { rollRequestId: string },
) =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-verdict-1477',
        prompt: `The party reaches the ledge.\n\n<player_input>${playerInput}</player_input>`,
        player_input: playerInput,
        history,
        ...(dmReply
          ? {
              dmReply: {
                messageId: '33333333-3333-4333-8333-333333333333',
                inCombat: false,
                ...dmReply,
              },
            }
          : {}),
        maxTokens: 1000,
        temperature: 0.8,
        provider: 'openrouter',
        requestType: 'user',
      }),
    }),
  );

const verdictLogs = () =>
  warnings.filter((line) => String(line.msg).startsWith('DM_CHECK_VERDICT'));

describe('#1477: the DM prompt carries the server verdict for the roll being answered', () => {
  beforeEach(() => {
    generatedInputs = [];
    warnings = [];
    lookupCalls = 0;
    savedChecks = [
      { rollRequestId: HARD_ROLL, message: TWELVE_FAIL, verdict: 'FAIL' },
      { rollRequestId: EASY_ROLL, message: TWELVE_SUCCESS, verdict: 'SUCCESS' },
    ];
  });

  it('uses the row for the current roll request, not an identical-looking row from another roll', async () => {
    const response = await postTurn(
      [{ role: 'user', content: TWELVE_CLIENT_SUCCESS }],
      TWELVE_CLIENT_SUCCESS,
      { rollRequestId: HARD_ROLL },
    );

    expect(response.status).toBe(200);
    const sent = generatedInputs[0]!;
    expect((sent.history as Array<{ content: string }>).at(-1)?.content).toBe(TWELVE_FAIL);
    expect(String(sent.prompt)).toContain(TWELVE_FAIL);
    expect(String(sent.prompt)).not.toContain(TWELVE_CLIENT_SUCCESS);
    expect(verdictLogs().map((line) => line.msg)).toEqual(['DM_CHECK_VERDICT_MISMATCH']);
  });

  it('agrees with the easier roll when that is the request being answered', async () => {
    const response = await postTurn(
      [{ role: 'user', content: TWELVE_CLIENT_SUCCESS }],
      TWELVE_CLIENT_SUCCESS,
      { rollRequestId: EASY_ROLL },
    );

    expect(response.status).toBe(200);
    const sent = generatedInputs[0]!;
    expect((sent.history as Array<{ content: string }>).at(-1)?.content).toBe(
      TWELVE_CLIENT_SUCCESS,
    );
    expect(String(sent.prompt)).toContain(TWELVE_CLIENT_SUCCESS);
    expect(verdictLogs()).toEqual([]);
  });

  it('keeps the client line and logs the no-row count when the current roll has no saved row', async () => {
    const response = await postTurn(
      [{ role: 'user', content: TWELVE_CLIENT_SUCCESS }],
      TWELVE_CLIENT_SUCCESS,
      { rollRequestId: 'roll-not-saved' },
    );

    expect(response.status).toBe(200);
    const sent = generatedInputs[0]!;
    expect((sent.history as Array<{ content: string }>).at(-1)?.content).toBe(
      TWELVE_CLIENT_SUCCESS,
    );
    expect(String(sent.prompt)).toContain(TWELVE_CLIENT_SUCCESS);
    expect(verdictLogs()).toEqual([
      expect.objectContaining({ msg: 'DM_CHECK_VERDICT_NO_ROW', count: 1 }),
    ]);
  });

  it('keeps the client line and logs the no-row count when the turn names no roll request', async () => {
    const response = await postTurn(
      [{ role: 'user', content: TWELVE_CLIENT_SUCCESS }],
      TWELVE_CLIENT_SUCCESS,
    );

    expect(response.status).toBe(200);
    expect((generatedInputs[0]!.history as Array<{ content: string }>).at(-1)?.content).toBe(
      TWELVE_CLIENT_SUCCESS,
    );
    expect(verdictLogs().map((line) => line.msg)).toEqual(['DM_CHECK_VERDICT_NO_ROW']);
  });

  it('replaces a client SUCCESS with the server FAIL for the saved check row of the request (#1477 fixture)', async () => {
    savedChecks = [
      { rollRequestId: 'roll-fixture', message: ABILITY_CHECK_ROW_FAIL.text, verdict: 'FAIL' },
    ];
    const client = 'Athletics check: 9 (nat 4+5) success';
    const response = await postTurn([{ role: 'user', content: client }], client, {
      rollRequestId: 'roll-fixture',
    });

    expect(response.status).toBe(200);
    const sent = generatedInputs[0]!;
    expect((sent.history as Array<{ content: string }>).at(-1)?.content).toBe(
      'Athletics check: 9 (nat 4+5) fail',
    );
    expect(String(sent.prompt)).toContain('Athletics check: 9 (nat 4+5) fail');
  });

  it('sends a turn with no check line byte-for-byte as the client wrote it, with no lookup and no verdict log', async () => {
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      {
        role: 'assistant',
        content: 'The ledge is slick with rain. Make an Athletics check to climb.',
      },
      { role: 'user', content: 'I search the room for a rope.' },
    ];
    const playerInput = 'I search the room for a rope.';
    const prompt = `The party reaches the ledge.\n\n<player_input>${playerInput}</player_input>`;
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'session-verdict-1477',
          prompt,
          player_input: playerInput,
          history,
          dmReply: {
            messageId: '33333333-3333-4333-8333-333333333333',
            inCombat: false,
            rollRequestId: EASY_ROLL,
          },
          maxTokens: 1000,
          temperature: 0.8,
          provider: 'openrouter',
          requestType: 'user',
        }),
      }),
    );

    expect(response.status).toBe(200);
    const sent = generatedInputs[0]!;
    // Byte-for-byte: the provider gets the same prompt and history text the client sent.
    expect(sent.prompt).toBe(prompt);
    expect(JSON.stringify(sent.history)).toBe(JSON.stringify(history));
    expect(lookupCalls).toBe(0);
    expect(verdictLogs()).toEqual([]);
  });
});
