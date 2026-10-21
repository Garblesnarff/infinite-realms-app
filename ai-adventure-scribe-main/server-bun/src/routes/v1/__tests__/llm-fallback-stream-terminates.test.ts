/**
 * #783 task 2 (reproduction): fallback chain must close the SSE stream.
 *
 * Drives the REAL POST /v1/llm/generate handler with a single-candidate
 * (Haiku) chain where every attempt answers in prose (fails ajv), i.e. the
 * chain is exhausted by validation failures. Asserts the SSE stream
 * terminates with a `done` or `error` event — the fallback must never leave
 * the turn open with the client waiting forever.
 *
 * No live provider calls: globalThis.fetch is stubbed to replay a recorded
 * Haiku SSE stream. The full candidate/retry/validation chain runs for real.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'fallback-user', plan: 'free' },
    error: null,
  }),
}));

const loggedErrors: Record<string, unknown>[] = [];
const loggedWarns: Record<string, unknown>[] = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: (entry: unknown) => {
    if (entry && typeof entry === 'object') loggedWarns.push(entry as Record<string, unknown>);
  },
  error: (entry: unknown) => {
    if (entry && typeof entry === 'object') loggedErrors.push(entry as Record<string, unknown>);
  },
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
mock.module('../../../lib/alerting.js', () => ({ alert: () => {} }));
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

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { llmRoutes } = await import('../llm.js');
const { resetCircuitBreakersForTests } = await import('../../../utils/circuit-breaker.js');

const app = createRequestPipelineApp().use(llmRoutes);

// A Haiku reply in prose: valid narration, not valid JSON, so the ajv
// validation on the instructed branch fails every time.
const HAIKU_PROSE = 'The tavern door creaks open on rusted hinges.';

const sseBodyFor = (prose: string): string => `${sseChunk(prose)}data: [DONE]\n\n`;

/** One forced-tool argument fragment chunk — the real #855 Haiku reply shape
 * (delta.tool_calls[0].function.arguments); no [DONE] is needed mid-list. */
const sseToolCallFor = (args: string): string =>
  `data: ${JSON.stringify({
    choices: [
      {
        delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
        finish_reason: 'stop',
      },
    ],
  })}\n\ndata: [DONE]\n\n`;

/** One content SSE data chunk (no [DONE], no stream end) — for the never-closing-body case. */
const sseChunk = (prose: string): string =>
  `data: ${JSON.stringify({
    choices: [{ delta: { content: prose }, finish_reason: 'stop' }],
  })}\n\n`;

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

describe('POST /v1/llm/generate fallback chain closes the SSE stream (#783)', () => {
  beforeEach(() => {
    loggedErrors.length = 0;
    loggedWarns.length = 0;
    resetCircuitBreakersForTests();
    // Single-candidate chain: Haiku only (dedupe collapses the fallback list).
    // Fixture replay must stay off so the stubbed fetch is what the chain hits.
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-4-5';
    process.env.OPENROUTER_FALLBACK_MODELS = 'anthropic/claude-haiku-4-5';
    delete process.env.LLM_FIXTURE_DIR;
    // Short timeout seam (#783): the provider reads this lazily; the
    // never-ending-body case below relies on a 250ms abort deadline.
    process.env.LLM_TEXT_PROVIDER_TIMEOUT_MS = '250';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('#875 keeps tool options out of preview and final narration through the real provider', async () => {
    const story = 'She says "Welcome" and opens the door.';
    const raw = JSON.stringify({
      options: ['A. Enter', 'B. Wait'],
      text: story + '\noptions: ["A. Enter", "B.',
      narration_segments: [],
      roll_requests: [],
      combat_transition: 'none',
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
    });
    globalThis.fetch = (async () =>
      new Response(
        Array.from(raw, (fragment) =>
          sseToolCallFor(fragment).replace('data: [DONE]\n\n', ''),
        ).join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      )) as unknown as typeof fetch;
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Continue', stream: true }),
      }),
    );
    expect(response.status).toBe(200);
    const wire = await response.text();
    const events = wire
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    const preview = events
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    expect(preview).toBe(story);
    const done = events.find((event) => event.type === 'done');
    expect(done).toBeDefined();
    expect(JSON.parse(done.payload.text).text).toBe(story);
    expect(JSON.parse(done.payload.text).options).toEqual(['A. Enter', 'B. Wait']);
  });

  it('terminates the SSE stream after the last candidate fails ajv validation', async () => {
    // The model answers in plain prose despite the forced tool (#855): the
    // provider falls back to the content text, which is not valid JSON, so
    // validation fails on every attempt.
    let fetchCalls = 0;
    globalThis.fetch = (async (_input: unknown, _init?: RequestInit) => {
      fetchCalls += 1;
      return new Response(sseBodyFor(HAIKU_PROSE), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const run = async (): Promise<string> => {
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'You stand at the tavern door.',
            stream: true,
            responseSchema: {
              type: 'object',
              required: ['text'],
              properties: { text: { type: 'string' } },
            },
          }),
        }),
      );
      expect(response.status).toBe(200);
      return await response.text();
    };

    // The stream MUST terminate: a hanging fallback chain leaves the client
    // waiting forever. Race the turn against a hard timeout.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const text = await Promise.race([
      run(),
      new Promise<string>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('SSE stream never terminated: fallback hung')),
          15_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));

    // Exact replay count: the prose reply takes the break-after-one-attempt
    // path (1 fetch per generation), and the route retries the failed
    // generation once (#312), so the chain runs twice total.
    expect(fetchCalls).toBe(2);
    // The chain exhausted by validation failures: every attempt answered in
    // prose, so the server logs the chain-exhausted line.
    expect(loggedErrors.some((e) => e.msg === 'LLM_OPENROUTER_CHAIN_EXHAUSTED')).toBe(true);
    // The stream carries a terminal event.
    expect(text.includes('"type":"done"') || text.includes('"type":"error"')).toBe(true);
  }, 30_000);

  it('terminates after two ajv-failing attempts on the same candidate', async () => {
    // Valid JSON that fails the schema: NOT a prose reply, so the tool path
    // (#855) retries once (two attempts total) before the chain exhausts.
    // Replay shape follows the real producer: forced-tool argument fragments.
    let fetchCalls = 0;
    globalThis.fetch = (async (_input: unknown, _init?: RequestInit) => {
      fetchCalls += 1;
      return new Response(sseToolCallFor('{"text": 42}'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const run = async (): Promise<string> => {
      const response = await app.handle(
        new Request('http://localhost/v1/llm/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: 'You stand at the tavern door.',
            stream: true,
            responseSchema: {
              type: 'object',
              required: ['text'],
              properties: { text: { type: 'string' } },
            },
          }),
        }),
      );
      expect(response.status).toBe(200);
      return await response.text();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const text = await Promise.race([
      run(),
      new Promise<string>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('SSE stream never terminated: fallback hung')),
          15_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));

    // Exact replay count: two provider attempts per generation (the
    // instructed branch retries a schema mismatch once), and the route
    // retries the failed generation once (#312): 2 attempts x 2 runs = 4.
    expect(fetchCalls).toBe(4);
    expect(loggedErrors.some((e) => e.msg === 'LLM_OPENROUTER_CHAIN_EXHAUSTED')).toBe(true);
    expect(text.includes('"type":"done"') || text.includes('"type":"error"')).toBe(true);
  }, 30_000);

  it('terminates when the attempt body never closes (#783 suspect 1)', async () => {
    // The upstream stream emits one partial chunk and then never ends —
    // the exact shape of the prod stall. A real network body is torn down
    // when the fetch signal aborts (the pending read() rejects); mirror
    // that boundary so the 250ms abort deadline fails the attempt.
    let fetchCalls = 0;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      fetchCalls += 1;
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseChunk('The tavern door')));
          signal?.addEventListener('abort', () => {
            try {
              controller.error(signal.reason ?? new Error('aborted'));
            } catch {
              // Already closed; the pending read has settled.
            }
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'You stand at the tavern door.',
          stream: true,
          responseSchema: {
            type: 'object',
            required: ['text'],
            properties: { text: { type: 'string' } },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const text = await Promise.race([
      response.text(),
      new Promise<string>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('SSE stream never terminated: stall hung')),
          10_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));

    // Two stalled attempts per generation (the attempt-level catch retries
    // once when a schema is present), and the route retries the failed
    // generation once (#312): 2 attempts x 2 runs = 4.
    expect(fetchCalls).toBe(4);
    expect(loggedErrors.some((e) => e.msg === 'LLM_OPENROUTER_CHAIN_EXHAUSTED')).toBe(true);
    expect(text.includes('"type":"done"') || text.includes('"type":"error"')).toBe(true);
  }, 30_000);
});

describe('POST /v1/llm/generate #875 leaks on the strict path', () => {
  beforeEach(() => {
    loggedErrors.length = 0;
    loggedWarns.length = 0;
    resetCircuitBreakersForTests();
    // Single-candidate chain on a strict-schema vendor (openai/): the reply
    // rides message.content, not a forced tool call.
    process.env.OPENROUTER_API_KEY = 'route-test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'openai/gpt-5-mini';
    process.env.OPENROUTER_FALLBACK_MODELS = 'openai/gpt-5-mini';
    delete process.env.LLM_FIXTURE_DIR;
    process.env.LLM_TEXT_PROVIDER_TIMEOUT_MS = '250';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  const story = 'You shift your grip on the rope and look down into the dark.';
  const envelope = (text: string, options: string[]): string =>
    JSON.stringify({
      text,
      options,
      narration_segments: [],
      roll_requests: [],
      combat_transition: 'none',
      map_actions: [],
      handout_actions: [],
      combatants: [],
      combat_actions: [],
    });

  it('keeps a strict-path options appendix out of the streamed preview and the done payload', async () => {
    const raw = envelope(story + '\noptions: ["A. Climb down", "B. Call out"]', [
      'A. Climb down',
    ]);
    // Strict candidates stream content deltas; split the envelope across chunks.
    const thirds = [raw.slice(0, 60), raw.slice(60, 130), raw.slice(130)];
    globalThis.fetch = (async () =>
      new Response(thirds.map((chunk) => sseChunk(chunk)).join('') + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Continue', stream: true }),
      }),
    );
    expect(response.status).toBe(200);
    const wire = await response.text();
    const events = wire
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)));
    const preview = events
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join('');
    expect(preview).toBe(story);
    const done = events.find((event) => event.type === 'done');
    expect(done).toBeDefined();
    expect(JSON.parse(done.payload.text).text).toBe(story);
    expect(JSON.parse(done.payload.text).options).toEqual(['A. Climb down']);
  });

  it('unwraps an envelope nested inside text before the reply leaves the route', async () => {
    const raw = envelope(envelope(story, ['A. Climb down', 'B. Call out']), []);
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: raw }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const response = await app.handle(
      new Request('http://localhost/v1/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Continue' }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { text: string; parsed: boolean };
    expect(payload.parsed).toBe(true);
    expect(JSON.parse(payload.text).text).toBe(story);
    expect(JSON.parse(payload.text).options).toEqual(['A. Climb down', 'B. Call out']);
  });
});
