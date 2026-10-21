import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import smokeTurn from '../../../../../shared/test-fixtures/deploy-smoke-generate.json';

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
    // client-sent value — byte-identical to what the old client was sending.
    expect(JSON.stringify(generatedInputs[0]?.responseSchema)).toBe(
      JSON.stringify(dmResponseSchema),
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
  });
});
