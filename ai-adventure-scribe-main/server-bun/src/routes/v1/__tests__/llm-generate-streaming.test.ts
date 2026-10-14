/**
 * #633 PR2: streaming DM turns.
 *
 * Drives the REAL POST /v1/llm/generate handler (LLMProviderService is NOT
 * mocked) against a RECORDED OpenRouter SSE fixture, asserting:
 *  (a) narration chunks stream to the client in order,
 *  (b) the final accumulated text parses through the REAL parseDmResponse
 *      and validates against the schema,
 *  (c) the non-streaming fallback path still works unchanged, with a payload
 *      identical in shape to the streamed one.
 *
 * Fixture provenance: the SSE chunk framing follows OpenRouter's
 * chat-completions streaming docs (`data:` lines, `: OPENROUTER PROCESSING`
 * keepalives, `data: [DONE]`, usage on the final chunk); the envelope
 * follows the real `createDmResponseSchema` output (every required
 * top-level field present). No live provider calls.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

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
// NOTE: ../../../services/llm-provider-service.js is intentionally NOT
// mocked. The test drives the real generateOpenRouter against the recorded
// SSE fixture by stubbing globalThis.fetch below.

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { dmResponseSchema, parseDmResponse, parseLlmEnvelope } = await import(
  '../../../services/dm/dm-response-schema.js'
);

const app = createRequestPipelineApp().use(llmRoutes);

// A realistic DM-turn envelope: every top-level field the real
// `createDmResponseSchema` output requires, peaceful narration (no
// attack-declaring prose, so the combat-transition contract stays quiet).
const ENVELOPE = {
  text: 'The tavern door creaks open on lamplight and low voices. A hooded figure at the corner table looks up and gestures toward the empty chair. "You made it," she says quietly. What do you do?',
  options: [
    'A. **Take the seat** and ask what she knows.',
    'B. **Scan the room** for trouble first.',
  ],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
};
const ENVELOPE_JSON = JSON.stringify(ENVELOPE);

const sseChunk = (
  content: string,
  usage?: Record<string, unknown>,
): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-stream-fixture',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'test/model',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
    ...(usage ? { usage } : {}),
  })}\n\n`;

// Recorded provider stream: the envelope JSON cut into 7-char deltas (cuts
// land mid-escape, exercising partial-escape handling), a processing
// keepalive, usage on the final chunk, then [DONE].
const buildSseBody = (): string => {
  const deltas: string[] = [];
  for (let i = 0; i < ENVELOPE_JSON.length; i += 7) {
    deltas.push(ENVELOPE_JSON.slice(i, i + 7));
  }
  return (
    ': OPENROUTER PROCESSING\n\n' +
    deltas.map((d) => sseChunk(d)).join('') +
    sseChunk('', {
      prompt_tokens: 120,
      completion_tokens: 60,
      total_tokens: 180,
      prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 3 },
    }) +
    'data: [DONE]\n\n'
  );
};

let lastProviderRequestBody: Record<string, unknown> | undefined;
const realFetch = globalThis.fetch;

// The non-streaming answer for the same turn: OpenRouter's regular
// chat-completions JSON shape carrying the identical envelope.
const jsonBody = JSON.stringify({
  id: 'chatcmpl-json-fixture',
  object: 'chat.completion',
  created: 1_700_000_000,
  model: 'test/model',
  choices: [
    { index: 0, message: { role: 'assistant', content: ENVELOPE_JSON }, finish_reason: 'stop' },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 60,
    total_tokens: 180,
    prompt_tokens_details: { cached_tokens: 12, cache_write_tokens: 3 },
  },
});

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  lastProviderRequestBody = undefined;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (String(input).includes('openrouter.ai/api/v1/chat/completions')) {
      const reqBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      lastProviderRequestBody = reqBody;
      const streaming = reqBody.stream === true;
      return new Response(streaming ? buildSseBody() : jsonBody, {
        status: 200,
        headers: { 'content-type': streaming ? 'text/event-stream' : 'application/json' },
      });
    }
    return realFetch(input as never, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENROUTER_API_KEY;
});

// Body shape of LlmApiClient.generateText for a DM turn, with the real schema
// the client sends (src/services/ai-service.ts).
const dmBody = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    prompt: 'The party enters the tavern. Describe the room in one breath and ask what they do.',
    player_input: 'I look around the room',
    maxTokens: 8192,
    temperature: 0.9,
    history: [],
    provider: 'openrouter',
    requestType: 'user',
    responseSchema: dmResponseSchema,
    ...overrides,
  });

const postGenerate = (body: string): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/llm/generate', {
      method: 'POST',
      headers: { authorization: 'Bearer <redacted>', 'content-type': 'application/json' },
      body,
    }),
  );

const readSseEvents = async (res: Response): Promise<Array<Record<string, unknown>>> =>
  (await res.text())
    .split('\n\n')
    .filter((block) => block.length > 0)
    .map((block) => {
      const line = block.split('\n').find((l) => l.startsWith('data:')) ?? '';
      return JSON.parse(line.slice('data:'.length).trim()) as Record<string, unknown>;
    });

describe('POST /v1/llm/generate with stream: true (#633 PR2)', () => {
  it('streams narration deltas in order and ends with the full validated payload', async () => {
    const res = await postGenerate(dmBody({ stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // The provider call went out with streaming enabled.
    expect(lastProviderRequestBody?.stream).toBe(true);

    const events = await readSseEvents(res);
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(1);
    // (a) narration chunks stream to the client in order.
    const narration = deltas.map((d) => String(d.text)).join('');
    expect(narration).toBe(ENVELOPE.text);

    // The stream ends with exactly one done event carrying the final payload.
    expect(events[events.length - 1]?.type).toBe('done');
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    const payload = events[events.length - 1]?.payload as Record<string, unknown>;

    // Final payload shape matches the non-streaming JSON response.
    expect(payload.parsed).toBe(true);
    expect(typeof payload.text).toBe('string');
    expect(payload.provider).toBe('openrouter');
    expect(typeof payload.model).toBe('string');
    expect(Array.isArray(payload.usageIds)).toBe(true);

    // (b) the final accumulated text parses through the REAL parseDmResponse
    // and validates against the real schema.
    const envelope = parseLlmEnvelope(payload.text as string);
    expect(envelope).not.toBeNull();
    const parsed = parseDmResponse(envelope);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.text).toBe(ENVELOPE.text);
    }
    const required = (dmResponseSchema as { required: string[] }).required;
    for (const key of required) {
      expect(Object.prototype.hasOwnProperty.call(envelope, key)).toBe(true);
    }
  });

  it('keeps the non-streaming fallback unchanged with an identical payload shape', async () => {
    const streamedRes = await postGenerate(dmBody({ stream: true }));
    const streamedPayload = (
      (await readSseEvents(streamedRes)).find((e) => e.type === 'done')?.payload ??
      null
    ) as Record<string, unknown> | null;
    if (!streamedPayload) throw new Error('stream produced no done event');

    const res = await postGenerate(dmBody({}));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    // The provider call went out without the stream flag.
    expect(lastProviderRequestBody?.stream).toBeUndefined();
    const json = (await res.json()) as Record<string, unknown>;

    // (c) the fallback payload is identical in shape to the streamed one.
    expect(json).toEqual(streamedPayload);
  });
});
