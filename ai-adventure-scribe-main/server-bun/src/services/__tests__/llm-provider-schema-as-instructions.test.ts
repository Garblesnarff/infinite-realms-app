/**
 * #633: Anthropic models reject OpenRouter's strict json_schema response_format.
 * For those candidates the schema is sent as system-prompt instructions instead.
 * No live provider calls: fetch is stubbed.
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
// Main's live schema (see dm-response-phase.test.ts for provenance): the
// instructed system text must carry exactly these bytes on this path too
// (strategist HOLD at 342151ce, per-path test).
import mainDmResponseSchema from '../dm/__tests__/fixtures/main-dm-response-schema.json' with {
  type: 'json',
};
import {
  dmResponseSchema,
  dmResponseSchemaForPhase,
  parseDmResponse,
  parseLlmEnvelope,
} from '../dm/dm-response-schema.js';
import { modelSupportsStrictSchema } from '../llm-model-config.js';
import { findPhaseShadowMismatch, LLMProviderService } from '../llm-provider-service.js';
import { resetModelHealthForTests } from '../model-health.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetCircuitBreakersForTests();
  resetModelHealthForTests();
});

const VALID_DM_REPLY = JSON.stringify({
  text: 'The lantern flickers over a wet cobblestone street.',
  options: [],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
});

type Reply = { status?: number; content: string };

/** Stub OpenRouter: each call takes the next scripted reply (the last one repeats). */
function stubOpenRouter(replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
    if (bodies.at(-1)?.stream === true) {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: reply.content } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, {
        status: reply.status ?? 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply.content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: reply.status ?? 200 },
    );
  }) as unknown as typeof fetch;
  return bodies;
}

type Body = {
  model: string;
  messages: { role: string; content: unknown }[];
  response_format?: unknown;
};

const systemText = (body: Body): string => {
  const first = body.messages[0];
  if (first?.role !== 'system' || !Array.isArray(first.content)) return '';
  return (first.content as { text: string }[]).map((block) => block.text).join('');
};

function useAnthropicThenGemini(): void {
  process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
  process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
  process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
  // #783: anthropic/ defaults to the forced-tool path. These tests pin the
  // instructed path (schema as system text) explicitly, the path they cover.
  process.env.LLM_VENDOR_CAPABILITIES = '{"anthropic/": {"schemaDelivery": "instructed"}}';
}

describe('#633 modelSupportsStrictSchema', () => {
  it('is false only for anthropic/ model ids', () => {
    expect(modelSupportsStrictSchema('anthropic/claude-haiku-5.5')).toBe(false);
    expect(modelSupportsStrictSchema('google/gemini-3.1-flash-lite')).toBe(true);
    expect(modelSupportsStrictSchema('mistralai/mistral-nemo')).toBe(true);
  });
});

describe('#633 schema as instructions for Anthropic candidates', () => {
  it('sends no response_format and puts the schema in the system text', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    const body = bodies[0] as unknown as Body;
    expect(body.model).toBe('anthropic/claude-haiku-5.5');
    expect(body.response_format).toBeUndefined();
    const system = systemText(body);
    expect(system.startsWith('stable system block')).toBe(true);
    expect(system).toContain(
      'Reply with exactly one JSON object that matches this JSON Schema. No prose, no code fences.',
    );
    expect(system).toContain(JSON.stringify(dmResponseSchema));
    expect(body.messages.at(-1)).toEqual({
      role: 'user',
      content:
        'volatile user prompt\n\nReply with the JSON object only. The first character of your reply must be {.',
    });
    expect(body.messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('keeps the schema text byte-identical across turns so the cache block still hits', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    for (const prompt of ['first turn', 'second turn']) {
      await LLMProviderService.generate({
        prompt,
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        maxTokens: 100,
      });
    }

    expect(bodies).toHaveLength(2);
    expect(systemText(bodies[0] as unknown as Body)).toBe(systemText(bodies[1] as unknown as Body));
    // The cache breakpoint stays on the single system block.
    const first = (bodies[0] as unknown as Body).messages[0].content as {
      cache_control?: unknown;
    }[];
    expect(first[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('keeps the anthropic system message byte-identical across turns and pre-change', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);
    const expectedSystemText =
      'stable system block\n\n' +
      'Reply with exactly one JSON object that matches this JSON Schema. No prose, no code fences.' +
      '\n' +
      JSON.stringify(dmResponseSchema);
    const expectedSystemMessage = {
      role: 'system',
      content: [{ type: 'text', text: expectedSystemText, cache_control: { type: 'ephemeral' } }],
    };

    for (const prompt of ['first turn prompt', 'second turn prompt']) {
      await LLMProviderService.generate({
        prompt,
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        maxTokens: 100,
      });
    }

    expect(bodies).toHaveLength(2);
    expect((bodies[0] as unknown as Body).messages[0]).toEqual(expectedSystemMessage);
    expect((bodies[1] as unknown as Body).messages[0]).toEqual(expectedSystemMessage);
  });

  it('leaves the Gemini-first strict body free of the JSON reminder and assistant prefill', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    const body = bodies[0] as unknown as Body;
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'volatile user prompt' });
    expect(body.messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('accepts a Haiku reply that starts with { as-is, with no prepended brace', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(bodies).toHaveLength(1);
    expect(result.error).toBeUndefined();
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(result.text).toBe(VALID_DM_REPLY);
  });

  it('streams a Haiku reply that starts with { through onToken unchanged', async () => {
    useAnthropicThenGemini();
    stubOpenRouter([{ content: VALID_DM_REPLY }]);
    const deltas: string[] = [];

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
      onToken: (delta) => deltas.push(delta),
    });

    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(deltas.join('')).toBe(VALID_DM_REPLY);
    expect(result.text).toBe(VALID_DM_REPLY);
  });

  it('keeps the Gemini candidate request unchanged (strict json_schema, original messages)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    const body = bodies[0] as unknown as Body;
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'structured_response', strict: true, schema: dmResponseSchema },
    });
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: [
        { type: 'text', text: 'stable system block', cache_control: { type: 'ephemeral' } },
      ],
    });
  });

  it('accepts an Anthropic reply wrapped in json code fences as a valid DM response', async () => {
    useAnthropicThenGemini();
    stubOpenRouter([{ content: '```json\n' + VALID_DM_REPLY + '\n```' }]);

    const result = await LLMProviderService.generate({
      prompt: 'hello',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(result.error).toBeUndefined();
    const envelope = parseLlmEnvelope(result.text);
    expect(envelope).not.toBeNull();
    const parsed = parseDmResponse(envelope);
    expect(parsed.success).toBe(true);
  });

  it('fails over at once on a prose Anthropic reply (no same-prompt retry)', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([
      { content: 'The lantern gutters as you step inside.' },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(bodies.map((b) => (b as unknown as Body).model)).toEqual([
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.1-flash-lite',
    ]);
    const fallback = bodies[1] as unknown as Body;
    expect(fallback.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'structured_response', strict: true, schema: dmResponseSchema },
    });
    expect(fallback.messages[0]).toEqual({
      role: 'system',
      content: [
        { type: 'text', text: 'stable system block', cache_control: { type: 'ephemeral' } },
      ],
    });
    expect(fallback.messages.at(-1)).toEqual({ role: 'user', content: 'volatile user prompt' });
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
  });
});

// A reply that is valid JSON with `text` but fails the DM schema.
const BAD_DM_REPLY = JSON.stringify({
  ...JSON.parse(VALID_DM_REPLY),
  roll_requests: [null],
  xp_award: { amount: '50', reason: 'opened the door' },
  combat_transition: 'boom',
});

describe('#633 full-schema validation on the instructed branch', () => {
  it('rejects a bad-field reply, retries, then fails over to strict Gemini', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([
      { content: BAD_DM_REPLY },
      { content: BAD_DM_REPLY },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(bodies.map((b) => (b as unknown as Body).model)).toEqual([
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.1-flash-lite',
    ]);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
    expect((bodies[2] as unknown as Body).response_format).toBeDefined();
  });

  it('does the same when onToken is set, and signals a reset before each attempt', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([
      { content: BAD_DM_REPLY },
      { content: BAD_DM_REPLY },
      { content: VALID_DM_REPLY },
    ]);
    const deltas: string[] = [];
    let resets = 0;

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
      onToken: (delta) => deltas.push(delta),
      onAttemptStart: () => {
        resets += 1;
      },
    });

    expect(bodies.map((b) => (b as unknown as Body).model)).toEqual([
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.1-flash-lite',
    ]);
    expect(resets).toBe(3);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
    expect(result.text).toBe(VALID_DM_REPLY);
    expect(deltas.length).toBeGreaterThan(0);
  });
});

describe('#782 item 8: instructed branch shadows phase-only mismatches', () => {
  it('keeps a full-shape reply on a narrative turn and logs the phase shadow invalid', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchemaForPhase('narrative'),
        responseSchemaPhase: 'narrative',
        maxTokens: 100,
      });

      // Kept, not retried or failed over: the reply is valid under the full
      // schema, so its only defect is phase-narrowing (the dropped fight
      // arrays it still pads, as the old full schema required).
      expect(bodies).toHaveLength(1);
      expect(result.model).toBe('anthropic/claude-haiku-5.5');
      expect(result.text).toBe(VALID_DM_REPLY);
      const shadow = warn.mock.calls
        .map((call) => call[0] as { msg?: string; phase?: string })
        .find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID');
      expect(shadow?.phase).toBe('narrative');
    } finally {
      warn.mockRestore();
    }
  });

  it('still retries then fails over a reply malformed under the full schema too', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([
      { content: BAD_DM_REPLY },
      { content: BAD_DM_REPLY },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchemaForPhase('narrative'),
      responseSchemaPhase: 'narrative',
      maxTokens: 100,
    });

    expect(bodies.map((b) => (b as unknown as Body).model)).toEqual([
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.1-flash-lite',
    ]);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
  });
});

describe('#782 HOLD item 1: findPhaseShadowMismatch (true shadow)', () => {
  it('flags a dropped section on a narrative turn; ignores full/unknown phases and non-objects', () => {
    const fullReply = JSON.parse(VALID_DM_REPLY) as Record<string, unknown>;
    const mismatch = findPhaseShadowMismatch(fullReply, 'narrative');
    expect(mismatch).not.toBeNull();
    expect(mismatch?.keyword).toBe('additionalProperties');
    expect(findPhaseShadowMismatch(fullReply, 'full')).toBeNull();
    expect(findPhaseShadowMismatch(fullReply, undefined)).toBeNull();
    expect(findPhaseShadowMismatch(fullReply, 'bogus')).toBeNull();
    expect(findPhaseShadowMismatch('not an object', 'narrative')).toBeNull();
    // A narrative-clean reply (only narrative properties) has no mismatch.
    const narrativeClean = {
      text: 'The lantern flickers.',
      options: [],
      narration_segments: [],
      roll_requests: [],
      combat_transition: 'none',
      combatants: [],
      handout_actions: [],
    };
    expect(findPhaseShadowMismatch(narrativeClean, 'narrative')).toBeNull();
  });
});

describe('#782 HOLD item 1: instructed branch compares against the phase on a full request', () => {
  it('logs a phase-only mismatch for a full-valid reply on a narrative turn, and keeps it', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'narrative',
        maxTokens: 100,
      });

      // The request schema is today's full schema (true shadow); the reply
      // is valid under it, so its only defect is phase-narrowing (the
      // dropped fight arrays it still carries). Kept, counted, logged —
      // not retried, not failed over.
      expect(bodies).toHaveLength(1);
      expect(result.model).toBe('anthropic/claude-haiku-5.5');
      expect(result.text).toBe(VALID_DM_REPLY);
      // The instructed system text carries main's schema bytes exactly.
      expect(systemText(bodies[0] as unknown as Body)).toContain(
        JSON.stringify(mainDmResponseSchema),
      );
      expect(result.usage?.schemaShadowInvalid).toBe(1);
      const shadow = warn.mock.calls
        .map((call) => call[0] as { msg?: string; phase?: string })
        .find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID');
      expect(shadow?.phase).toBe('narrative');
    } finally {
      warn.mockRestore();
    }
  });

  it('logs nothing when the phase is full (no comparison to run)', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'full',
        maxTokens: 100,
      });

      expect(bodies).toHaveLength(1);
      expect(result.text).toBe(VALID_DM_REPLY);
      expect(result.usage?.schemaShadowInvalid).toBeUndefined();
      expect(
        warn.mock.calls
          .map((call) => call[0] as { msg?: string })
          .find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID'),
      ).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('#783 prefill handling is gated on responseSchema', () => {
  it('leaves a no-schema Anthropic reply unchanged and adds no assistant prefill', async () => {
    useAnthropicThenGemini();
    const bodies = stubOpenRouter([{ content: 'The lantern gutters as you step inside.' }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      maxTokens: 100,
    });

    expect(result.text).toBe('The lantern gutters as you step inside.');
    expect((bodies[0] as unknown as Body).messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('leaves a no-schema Anthropic reply unchanged with onToken (no injected brace)', async () => {
    useAnthropicThenGemini();
    stubOpenRouter([{ content: 'The lantern gutters as you step inside.' }]);
    const deltas: string[] = [];

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      maxTokens: 100,
      onToken: (delta) => deltas.push(delta),
    });

    expect(result.text).toBe('The lantern gutters as you step inside.');
    expect(deltas.join('')).toBe('The lantern gutters as you step inside.');
  });

  it('does not add a brace when the SSE stream opens with an empty content delta', async () => {
    useAnthropicThenGemini();
    globalThis.fetch = (async () => {
      const first = JSON.stringify({
        choices: [{ delta: { role: 'assistant', content: '' } }],
      });
      const second = JSON.stringify({ choices: [{ delta: { content: VALID_DM_REPLY } }] });
      const sse = `data: ${first}\n\ndata: ${second}\n\ndata: [DONE]\n\n`;
      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const deltas: string[] = [];
    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
      onToken: (delta) => deltas.push(delta),
    });

    expect(deltas.join('')).toBe(VALID_DM_REPLY);
    expect(result.text).toBe(VALID_DM_REPLY);
  });
});
