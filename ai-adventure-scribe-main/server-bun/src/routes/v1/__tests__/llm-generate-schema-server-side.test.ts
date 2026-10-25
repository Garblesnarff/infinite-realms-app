import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import smokeTurn from '../../../../../shared/test-fixtures/deploy-smoke-generate.json';
// Main's live schema, captured from the main tree's own module output (see
// server-bun/src/services/dm/__tests__/dm-response-phase.test.ts): the
// provider-bound schema must serialize byte-for-byte to this, not just to
// this branch's live object (strategist HOLD at 342151ce, per-path test).
import mainDmResponseSchema from '../../../services/dm/__tests__/fixtures/main-dm-response-schema.json' with {
  type: 'json',
};

let generatedInputs: Record<string, unknown>[] = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'smoke-user', email: 'smoke@example.test', plan: 'free' },
    error: null,
  }),
}));
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => testLogger,
};
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
    generate: async (input: Record<string, unknown>) => {
      generatedInputs.push(input);
      return {
        text: 'The frozen guests smell faintly of winter roses. What do you do?',
        provider: 'openrouter',
        model: 'test/model',
      };
    },
  },
}));

// Route contract tests stub persistence; roll serialization is exercised with real PostgreSQL.
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
  },
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
// What the old client sent: ai-service.ts imported this same export and put it
// on the request body as `responseSchema`.
// #782 item 8, strategist HOLD (true shadow): the live request keeps today's
// schema, unchanged, on every path — the picked phase only selects the
// comparison schema (asserted by the picker unit tests + the
// LLM_GENERATE_PHASE log), never the request schema. The assertions below
// pin today's live schema. The anti-injection property is unchanged:
// whatever the client sends is ignored.
const { dmResponseSchema } = await import('../../../services/dm/dm-response-schema.js');
const app = createRequestPipelineApp().use(llmRoutes);

const postGenerate = (body: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'The party enters the banquet hall. What do they see?',
        player_input: 'I look around',
        maxTokens: 8192,
        temperature: 0.9,
        provider: 'openrouter',
        requestType: 'user',
        ...body,
      }),
    }),
  );

describe('#782 item 3: DM reply schema built server-side', () => {
  it('accepts the exact smoke turn at the normal DM budget (#922)', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(smokeTurn),
      }),
    );
    expect(response.status).toBe(200);
    expect(generatedInputs.at(-1)).toMatchObject({
      prompt: smokeTurn.prompt,
      maxTokens: 8192,
      temperature: 0,
    });
  });

  it('ignores a client-sent responseSchema and sends the server-built schema to the provider', async () => {
    generatedInputs = [];
    const response = await postGenerate({
      // Old client behavior: the browser bundle sent the schema it imported.
      responseSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
      },
    });

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    // The provider must receive the canonical server-built schema, not the
    // client-sent value — byte-identical to today's live schema, whatever
    // phase the picker selected for comparison — and byte-identical to
    // main's schema, not just this branch's live object.
    expect(JSON.stringify(generatedInputs[0]?.responseSchema)).toBe(
      JSON.stringify(dmResponseSchema),
    );
    expect(JSON.stringify(generatedInputs[0]?.responseSchema)).toBe(
      JSON.stringify(mainDmResponseSchema),
    );
  });

  it('sends the same schema when the client omits responseSchema (new behavior)', async () => {
    generatedInputs = [];
    const response = await postGenerate({});

    expect(response.status).toBe(200);
    expect(generatedInputs).toHaveLength(1);
    expect(JSON.stringify(generatedInputs[0]?.responseSchema)).toBe(
      JSON.stringify(dmResponseSchema),
    );
    expect(JSON.stringify(generatedInputs[0]?.responseSchema)).toBe(
      JSON.stringify(mainDmResponseSchema),
    );
  });

  it('provider-bound schema is byte-identical with and without a client-sent value', async () => {
    generatedInputs = [];
    await postGenerate({
      responseSchema: { type: 'object', properties: { nope: {} } },
    });
    const withClientValue = JSON.stringify(generatedInputs[0]?.responseSchema);

    generatedInputs = [];
    await postGenerate({});
    const withoutClientValue = JSON.stringify(generatedInputs[0]?.responseSchema);

    // The Gemini request body is built from the provider input; identical
    // strings here mean a byte-identical schema on the wire before and after.
    expect(withClientValue).toBe(withoutClientValue);
    expect(withClientValue).toBe(JSON.stringify(dmResponseSchema));
    expect(withClientValue).toBe(JSON.stringify(mainDmResponseSchema));
  });
});
