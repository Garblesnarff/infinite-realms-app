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
let generatedInputs: CapturedInput[] = [];
let serverCheckRows: Array<{ message: string; verdict: 'SUCCESS' | 'FAIL' }> = [];

const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
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
// The persistence read the server does for the saved verdict. Stubbed: the rows are the
// server's saved check rows for this session (newest first).
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
    latestServerCheckRows: async () => serverCheckRows,
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const app = createRequestPipelineApp().use(llmRoutes);

// The client's own word is `success`. The server's saved row for the same roll says FAIL
// (total 9 < DC 15).
const CLIENT_LINE = 'Athletics check: 9 (nat 4+5) success';
const SERVER_LINE = 'Athletics check: 9 (nat 4+5) fail';

const postTurn = (
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  playerInput: string,
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
        maxTokens: 1000,
        temperature: 0.8,
        provider: 'openrouter',
        requestType: 'user',
      }),
    }),
  );

describe('#1477: the DM prompt carries the server verdict for a narrative check', () => {
  beforeEach(() => {
    generatedInputs = [];
    serverCheckRows = [{ message: ABILITY_CHECK_ROW_FAIL.text, verdict: 'FAIL' }];
  });

  it('replaces a client SUCCESS line with the server FAIL verdict in the history and the prompt', async () => {
    const response = await postTurn(
      [
        { role: 'assistant', content: 'Make an Athletics check to climb.' },
        { role: 'user', content: CLIENT_LINE },
      ],
      CLIENT_LINE,
    );

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    const sent = generatedInputs[0]!;
    const history = sent.history as Array<{ role: string; content: string }>;
    expect(history.at(-1)).toEqual({ role: 'user', content: SERVER_LINE });
    expect(String(sent.prompt)).toContain(SERVER_LINE);
    expect(String(sent.prompt)).not.toContain(CLIENT_LINE);
  });

  it('leaves the line alone when the client word already matches the server verdict', async () => {
    serverCheckRows = [
      {
        message: 'Athletics check: 17 (nat 12+5) success',
        verdict: 'SUCCESS',
      },
    ];
    const agreeing = 'Athletics check: 17 (nat 12+5) success';
    const response = await postTurn([{ role: 'user', content: agreeing }], agreeing);

    expect(response.status).toBe(200);
    const sent = generatedInputs[0]!;
    expect((sent.history as Array<{ content: string }>).at(-1)?.content).toBe(agreeing);
    expect(String(sent.prompt)).toContain(agreeing);
  });

  it('sends the client line unchanged when no saved check row matches it', async () => {
    serverCheckRows = [];
    const response = await postTurn([{ role: 'user', content: CLIENT_LINE }], CLIENT_LINE);

    expect(response.status).toBe(200);
    const sent = generatedInputs[0]!;
    expect((sent.history as Array<{ content: string }>).at(-1)?.content).toBe(CLIENT_LINE);
    expect(String(sent.prompt)).toContain(CLIENT_LINE);
  });
});
