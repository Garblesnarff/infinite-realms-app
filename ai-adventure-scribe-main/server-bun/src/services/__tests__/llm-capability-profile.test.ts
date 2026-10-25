/**
 * #782 item 4: vendor capability profile for DM schema delivery.
 * The table replaces the scattered modelSupportsStrictSchema conditional;
 * unknown vendors get the conservative fallback (instructions + ajv).
 * No live provider calls: fetch is stubbed.
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
// Main's live schema (see dm-response-phase.test.ts for provenance): the
// provider request must serialize byte-for-byte to this on every path
// (strategist HOLD at 342151ce, per-path test).
import mainDmResponseSchema from '../dm/__tests__/fixtures/main-dm-response-schema.json' with {
  type: 'json',
};
import { dmResponseSchema } from '../dm/dm-response-schema.js';
import { getVendorCapabilityProfile, modelSupportsStrictSchema } from '../llm-model-config.js';
import {
  LLMProviderService,
  parseStringifiedNested,
  setStrictBranchValidationModeForTests,
  stripOptionalNulls,
  validateToolReplyText,
} from '../llm-provider-service.js';
import { resetModelHealthForTests } from '../model-health.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetCircuitBreakersForTests();
  resetModelHealthForTests();
});

// Same shape the real DM producer emits (validates against dmResponseSchema).
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

/** One valid targeted combat action, for wrong-phase tests under the FIX-round-2 semantics (a non-empty dropped section still flags). */
const NON_EMPTY_COMBAT_ACTION = {
  actor_id: 'hero',
  action_type: 'attack',
  target_ids: ['goblin'],
  movement_feet: 0,
};

/** `toolArguments` makes the reply a forced `dm_reply` tool call (#783). */
type Reply = { status?: number; content?: string; toolArguments?: string };

/** Stub OpenRouter: each call takes the next scripted reply (the last one repeats). */
function stubOpenRouter(replies: Reply[]) {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const reply = replies[Math.min(bodies.length - 1, replies.length - 1)];
    const message =
      reply.toolArguments !== undefined
        ? {
            content: null,
            tool_calls: [
              {
                id: 'call_dm_reply',
                type: 'function',
                function: { name: 'dm_reply', arguments: reply.toolArguments },
              },
            ],
          }
        : { content: reply.content };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message,
            finish_reason: reply.toolArguments !== undefined ? 'tool_calls' : 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: reply.status ?? 200 },
    );
  }) as unknown as typeof fetch;
  return bodies;
}

/** #783: fake OpenRouter SSE stream. Each chunk is one `data:` event; the stream ends with [DONE]. */
function stubOpenRouterSse(chunks: unknown[]): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const sse =
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return bodies;
}

type Body = {
  model: string;
  messages: { role: string; content: unknown }[];
  max_tokens?: number;
  temperature?: number;
  usage?: unknown;
  stream?: boolean;
  response_format?: unknown;
  provider?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
};

const systemText = (body: Body): string => {
  const first = body.messages[0];
  if (first?.role !== 'system' || !Array.isArray(first.content)) return '';
  return (first.content as { text: string }[]).map((block) => block.text).join('');
};

const SCHEMA_INSTRUCTION_LINE =
  'Reply with exactly one JSON object that matches this JSON Schema. No prose, no code fences.';

function useModel(model: string): void {
  process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
  process.env.OPENROUTER_TEXT_MODEL = model;
  process.env.OPENROUTER_FALLBACK_MODELS = '';
}

describe('#782 item 4 getVendorCapabilityProfile', () => {
  it('gives strict structured output to every known vendor except anthropic/', () => {
    expect(getVendorCapabilityProfile('google/gemini-3.1-flash-lite').strictJsonSchema).toBe(true);
    expect(getVendorCapabilityProfile('anthropic/claude-haiku-5.5').strictJsonSchema).toBe(false);
    expect(getVendorCapabilityProfile('openai/gpt-5-mini').strictJsonSchema).toBe(true);
    expect(getVendorCapabilityProfile('mistralai/mistral-nemo').strictJsonSchema).toBe(true);
    expect(getVendorCapabilityProfile('meta-llama/llama-3.1-8b-instruct').strictJsonSchema).toBe(
      true,
    );
  });

  it('carries the #782 schema budget targets on every profile', () => {
    for (const model of [
      'google/gemini-3.1-flash-lite',
      'anthropic/claude-haiku-5.5',
      'openai/gpt-5-mini',
    ]) {
      const profile = getVendorCapabilityProfile(model);
      expect(profile.maxUnions).toBe(16);
      expect(profile.maxOptional).toBe(24);
      expect(profile.allowsOneOf).toBe(false);
      expect(profile.allowsNumericConstraints).toBe(false);
    }
  });

  it('falls back to conservative for unknown vendors and bare model ids', () => {
    for (const model of ['xai/grok-4', 'gemini-2.5-flash-lite', '', '  ']) {
      const profile = getVendorCapabilityProfile(model);
      expect(profile.strictJsonSchema).toBe(false);
    }
  });

  it('trims whitespace before extracting the vendor prefix', () => {
    expect(getVendorCapabilityProfile('  anthropic/claude-haiku-5.5  ').strictJsonSchema).toBe(
      false,
    );
    expect(getVendorCapabilityProfile('  google/gemini-3.1-flash-lite ').strictJsonSchema).toBe(
      true,
    );
  });

  it('keeps modelSupportsStrictSchema in agreement with the table', () => {
    expect(modelSupportsStrictSchema('anthropic/claude-haiku-5.5')).toBe(false);
    expect(modelSupportsStrictSchema('google/gemini-3.1-flash-lite')).toBe(true);
    expect(modelSupportsStrictSchema('mistralai/mistral-nemo')).toBe(true);
    expect(modelSupportsStrictSchema('xai/grok-4')).toBe(false);
  });

  it('strips OpenRouter ~vendor/ aliases before the table lookup', () => {
    // ~google/ must resolve to the google/ profile (strict), not the
    // conservative fallback — an alias silently dropping the strict schema
    // was the #797 FIX.
    expect(getVendorCapabilityProfile('~google/gemini-3.1-flash-lite').strictJsonSchema).toBe(true);
    expect(getVendorCapabilityProfile('~anthropic/claude-haiku-5.5').strictJsonSchema).toBe(false);
  });

  it('resolves ~aliases through the table, not the unknown-vendor fallback', () => {
    // An env override for the bare prefix must also apply to the alias —
    // that only happens if the alias went through the table lookup.
    process.env.LLM_VENDOR_CAPABILITIES = '{"anthropic/": {"strictJsonSchema": true}}';
    expect(getVendorCapabilityProfile('~anthropic/claude-haiku-5.5').strictJsonSchema).toBe(true);
    // Without the override it is the table's instructions path.
    delete process.env.LLM_VENDOR_CAPABILITIES;
    const profile = getVendorCapabilityProfile('~anthropic/claude-haiku-5.5');
    expect(profile.strictJsonSchema).toBe(false);
    expect(profile.maxUnions).toBe(16);
  });
});

describe('#782 item 4 LLM_VENDOR_CAPABILITIES env override', () => {
  it('flips a single field while leaving the rest of the profile intact', () => {
    process.env.LLM_VENDOR_CAPABILITIES = '{"anthropic/": {"strictJsonSchema": true}}';
    const profile = getVendorCapabilityProfile('anthropic/claude-haiku-5.5');
    expect(profile.strictJsonSchema).toBe(true);
    expect(profile.maxUnions).toBe(16);
    expect(profile.streaming).toBe(true);
    // Other vendors are untouched.
    expect(getVendorCapabilityProfile('google/gemini-3.1-flash-lite').strictJsonSchema).toBe(true);
  });

  it('overrides a budget field', () => {
    process.env.LLM_VENDOR_CAPABILITIES = '{"google/": {"maxUnions": 8}}';
    expect(getVendorCapabilityProfile('google/gemini-3.1-flash-lite').maxUnions).toBe(8);
  });

  it('can introduce an entirely new vendor prefix', () => {
    process.env.LLM_VENDOR_CAPABILITIES = '{"xai/": {"strictJsonSchema": true}}';
    const profile = getVendorCapabilityProfile('xai/grok-4');
    expect(profile.strictJsonSchema).toBe(true);
    expect(profile.maxUnions).toBe(16);
  });

  it('ignores malformed JSON, unknown fields, and wrong-typed values', () => {
    process.env.LLM_VENDOR_CAPABILITIES = 'not json{';
    expect(getVendorCapabilityProfile('google/gemini-3.1-flash-lite').strictJsonSchema).toBe(true);

    process.env.LLM_VENDOR_CAPABILITIES =
      '{"google/": {"strictJsonSchema": "yes", "bogusField": 1}}';
    const profile = getVendorCapabilityProfile('google/gemini-3.1-flash-lite');
    expect(profile.strictJsonSchema).toBe(true);
    expect(profile).not.toHaveProperty('bogusField');
  });
});

describe('#782 item 4 OpenRouter request bodies', () => {
  it('google/ keeps the strict schema byte-identical and adds require_parameters', async () => {
    useModel('google/gemini-3.1-flash-lite');
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    // The strict schema mechanism is unchanged: the exact live schema object
    // goes in response_format, serialized exactly as before.
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'structured_response', strict: true, schema: dmResponseSchema },
    });
    expect(
      JSON.stringify(
        (body.response_format as { json_schema: { schema: unknown } }).json_schema.schema,
      ),
    ).toBe(JSON.stringify(dmResponseSchema));
    // The only wire change: OpenRouter must route to a provider that
    // supports the requested parameters.
    expect(body.provider).toEqual({ require_parameters: true });
    // Full body shape, so any other unintended wire change fails here.
    expect(body).toEqual({
      model: 'google/gemini-3.1-flash-lite',
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'stable system block', cache_control: { type: 'ephemeral' } },
          ],
        },
        { role: 'user', content: 'volatile user prompt' },
      ],
      max_tokens: 100,
      temperature: 0.8,
      usage: { include: true },
      provider: { require_parameters: true },
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'structured_response', strict: true, schema: dmResponseSchema },
      },
    });
    expect(body.temperature).toBe(0.8);
    expect(result.usage?.schemaDelivery).toBe('strict-json-schema');
  });

  it('anthropic/ sends the DM schema as one forced tool, with no schema system text', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const bodies = stubOpenRouter([{ toolArguments: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'dm_reply',
          description: 'The DM reply for this turn.',
          parameters: dmResponseSchema,
        },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'dm_reply' } });
    expect(body.response_format).toBeUndefined();
    // #783: no provider routing and no temperature on the forced-tool request.
    expect('provider' in body).toBe(false);
    expect('temperature' in body).toBe(false);
    // The schema rides only in tools: no instruction line, no schema text in system.
    expect(systemText(body)).toBe(
      'stable system block\nThe options belong only in the options field; never append an options block to text.',
    );
    expect(JSON.stringify(body.messages)).not.toContain(SCHEMA_INSTRUCTION_LINE);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'volatile user prompt' });
    expect(result.text).toBe(VALID_DM_REPLY);
    expect(result.usage?.schemaDelivery).toBe('forced-tool-call');
  });

  it('anthropic/ tool path streams argument fragments through onToken and the joined text is the reply', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const half = Math.floor(VALID_DM_REPLY.length / 2);
    const fragments = [VALID_DM_REPLY.slice(0, half), VALID_DM_REPLY.slice(half)];
    const bodies = stubOpenRouterSse([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_dm_reply',
                  function: { name: 'dm_reply', arguments: fragments[0] },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: fragments[1] } }] } }],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ]);
    const tokens: string[] = [];

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
      onToken: (delta) => tokens.push(delta),
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    expect(body.stream).toBe(true);
    expect(body.tools).toBeDefined();
    expect(body.response_format).toBeUndefined();
    expect(tokens).toEqual(fragments);
    expect(result.text).toBe(VALID_DM_REPLY);
    expect(result.usage?.schemaDelivery).toBe('forced-tool-call');
  });

  it('a streamed google/ strict reply is unchanged: content deltas go through onToken, response_format and provider stay', async () => {
    useModel('google/gemini-3.1-flash-lite');
    const half = Math.floor(VALID_DM_REPLY.length / 2);
    const pieces = [VALID_DM_REPLY.slice(0, half), VALID_DM_REPLY.slice(half)];
    const bodies = stubOpenRouterSse([
      { choices: [{ delta: { content: pieces[0] } }] },
      { choices: [{ delta: { content: pieces[1] }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ]);
    const tokens: string[] = [];

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
      onToken: (delta) => tokens.push(delta),
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    expect(body.stream).toBe(true);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'structured_response', strict: true, schema: dmResponseSchema },
    });
    expect(tokens).toEqual(pieces);
    expect(result.text).toBe(VALID_DM_REPLY);
    expect(result.usage?.schemaDelivery).toBe('strict-json-schema');
  });

  it('unknown vendors take the conservative path: instructions, no response_format', async () => {
    useModel('xai/grok-4');
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(result.model).toBe('xai/grok-4');
    const body = bodies[0] as unknown as Body;
    expect(body.response_format).toBeUndefined();
    expect('provider' in body).toBe(false);
    expect(systemText(body)).toContain(SCHEMA_INSTRUCTION_LINE);
    expect(systemText(body)).toContain(JSON.stringify(dmResponseSchema));
    expect(result.usage?.schemaDelivery).toBe('schema-as-instructions');
  });

  it('leaves schemaDelivery unset on schema-less turns', async () => {
    useModel('google/gemini-3.1-flash-lite');
    stubOpenRouter([{ content: 'plain text reply' }]);

    const result = await LLMProviderService.generate({
      prompt: 'hello',
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(result.usage?.schemaDelivery).toBeUndefined();
  });

  it('an env override flips the wire path for the overridden vendor', async () => {
    process.env.LLM_VENDOR_CAPABILITIES = '{"anthropic/": {"strictJsonSchema": true}}';
    useModel('anthropic/claude-haiku-5.5');
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    expect(body.response_format).toBeDefined();
    expect(result.usage?.schemaDelivery).toBe('strict-json-schema');
  });

  it('~google/ alias sends the strict body, matching the bare vendor', async () => {
    useModel('~google/gemini-3.1-flash-lite');
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    // The alias must not silently drop the strict schema: response_format
    // present and byte-identical to the bare google/ vendor's.
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'structured_response', strict: true, schema: dmResponseSchema },
    });
    expect(body.provider).toEqual({ require_parameters: true });
    // The ~ alias itself rides on the wire untouched — OpenRouter needs it
    // for vendor pinning; only the capability lookup normalizes it.
    expect(body.model).toBe('~google/gemini-3.1-flash-lite');
    expect(result.usage?.schemaDelivery).toBe('strict-json-schema');
  });

  it('falls through when the strict candidate is refused, keeping require_parameters on strict attempts', async () => {
    // #797 FIX: provider.require_parameters is a live routing change — when
    // OpenRouter has no endpoint with structured_outputs for the strict
    // candidate, the chain must fall through to the next candidate.
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
    process.env.OPENROUTER_FALLBACK_MODELS = 'anthropic/claude-haiku-5.5';
    const bodies = stubOpenRouter([
      { status: 400, content: 'No endpoints found that support tool parameters' },
      { status: 400, content: 'No endpoints found that support tool parameters' },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    // The strict candidate was tried twice (schema retry), then the chain
    // fell through to the forced-tool candidate.
    expect(bodies.length).toBe(3);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    // require_parameters rides only on the strict json_schema attempts (the
    // two refused google/ calls). The forced-tool anthropic/ attempt has none (#783).
    expect((bodies[0] as Body).provider).toEqual({ require_parameters: true });
    expect((bodies[1] as Body).provider).toEqual({ require_parameters: true });
    expect('provider' in (bodies[2] as Body)).toBe(false);
    expect('temperature' in (bodies[2] as Body)).toBe(false);
    // The winning candidate's delivery path is logged on the usage object.
    expect(result.usage?.schemaDelivery).toBe('forced-tool-call');
  });
});

describe('#783 temperature and require_parameters gating on OpenRouter', () => {
  it('anthropic/ bodies carry neither temperature nor provider, with or without a schema', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }, { content: 'plain text reply' }]);

    const withSchema = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });
    const schemaless = await LLMProviderService.generate({
      prompt: 'hello',
      maxTokens: 100,
    });

    expect(withSchema.error).toBeUndefined();
    expect(schemaless.error).toBeUndefined();
    for (const body of bodies as unknown as Body[]) {
      expect('temperature' in body).toBe(false);
      expect('provider' in body).toBe(false);
    }
  });

  it('google/ strict bodies carry temperature and provider require_parameters', async () => {
    useModel('google/gemini-3.1-flash-lite');
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    expect(body.temperature).toBe(0.8);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(result.usage?.schemaDelivery).toBe('strict-json-schema');
  });

  it('google/ non-strict (shadow) bodies carry temperature but no provider', async () => {
    process.env.LLM_VENDOR_CAPABILITIES = '{"google/": {"strictJsonSchema": false}}';
    useModel('google/gemini-3.1-flash-lite');
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    expect(body.response_format).toBeUndefined();
    expect(body.temperature).toBe(0.8);
    expect('provider' in body).toBe(false);
    expect(result.usage?.schemaDelivery).toBe('schema-as-instructions');
  });

  it('schema-less google/ bodies send no provider field', async () => {
    useModel('google/gemini-3.1-flash-lite');
    const bodies = stubOpenRouter([{ content: 'plain text reply' }]);

    await LLMProviderService.generate({ prompt: 'hello', maxTokens: 100 });

    const body = bodies[0] as unknown as Body;
    expect(body.temperature).toBe(0.8);
    expect('provider' in body).toBe(false);
  });

  it('extraction omits temperature for an anthropic/ extraction model', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_EXTRACTION_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_EXTRACTION_FALLBACK_MODEL = 'anthropic/claude-haiku-5.5';
    const bodies = stubOpenRouter([{ content: '{}' }]);

    const result = await LLMProviderService.extract({ prompt: 'extract this', maxTokens: 100 });

    expect(result.error).toBeUndefined();
    const body = bodies[0] as unknown as Body;
    expect('temperature' in body).toBe(false);
    expect('provider' in body).toBe(false);
  });
});

describe('#783 forced-tool delivery for anthropic/', () => {
  it('a tool-call reply with an extra top-level key validates after stripping and is returned as the reply', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const withExtra = JSON.stringify({ ...JSON.parse(VALID_DM_REPLY), visual_prompt: 'a lantern' });
    const bodies = stubOpenRouter([{ toolArguments: withExtra }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(1);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(result.text).toBe(VALID_DM_REPLY);
    expect(JSON.parse(result.text)).not.toHaveProperty('visual_prompt');
  });

  it('#875 strips an options appendix inside tool text and keeps structured options', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const reply = JSON.parse(VALID_DM_REPLY);
    const story = reply.text;
    reply.text += '\noptions: ["A. Sit", "B.';
    const bodies = stubOpenRouter([{ toolArguments: JSON.stringify(reply) }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(reply.options);
    expect(JSON.stringify(bodies[0].messages)).toContain(
      'The options belong only in the options field',
    );
  });

  it('a tool-call reply missing a required key fails validation and falls over to the next candidate', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
    const { options: _omitted, ...missingOptions } = JSON.parse(VALID_DM_REPLY);
    const bodies = stubOpenRouter([
      { toolArguments: JSON.stringify(missingOptions) },
      { toolArguments: JSON.stringify(missingOptions) },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    // Two forced-tool attempts (schema retry), then the chain fell over to google/.
    expect(bodies).toHaveLength(3);
    expect((bodies[0] as Body).tools).toBeDefined();
    expect((bodies[1] as Body).tools).toBeDefined();
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
    expect((bodies[2] as Body).response_format).toBeDefined();
  });

  it('a plain-content reply on the tool path is the prose case: no retry, fail over at once', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
    const bodies = stubOpenRouter([
      { content: 'The lantern flickers over a wet cobblestone street.' },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(2);
    expect((bodies[0] as Body).tools).toBeDefined();
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
  });

  it('a tool reply with null optional fields (scene_spec, character) validates, drops them, and Haiku is served', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const withNulls = {
      ...JSON.parse(VALID_DM_REPLY),
      narration_segments: [
        { type: 'character', text: 'I hold the lantern higher.', character: null },
      ],
      scene_spec: null,
    };
    const bodies = stubOpenRouter([{ toolArguments: JSON.stringify(withNulls) }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(1);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    const reply = JSON.parse(result.text);
    expect(reply).not.toHaveProperty('scene_spec');
    expect(reply.narration_segments).toEqual([
      { type: 'character', text: 'I hold the lantern higher.' },
    ]);
  });

  it('a tool reply with a REQUIRED key set to null still fails validation and falls over', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
    const nullRequired = { ...JSON.parse(VALID_DM_REPLY), options: null };
    expect(() => validateToolReplyText(JSON.stringify(nullRequired), dmResponseSchema)).toThrow(
      /does not match schema/,
    );
    const bodies = stubOpenRouter([
      { toolArguments: JSON.stringify(nullRequired) },
      { toolArguments: JSON.stringify(nullRequired) },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(3);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
  });

  it('stripOptionalNulls walks nested array-of-objects, dropping optional nulls and keeping required ones', () => {
    const schema = {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              note: { type: 'string' },
              members: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, role: { type: 'string' } },
                  required: ['id'],
                },
              },
            },
            required: ['label', 'members'],
          },
        },
      },
      required: ['groups'],
    };
    const data = {
      groups: [
        {
          label: 'A',
          note: null,
          members: [
            { id: 'm1', role: null },
            { id: null, role: 'scout' },
          ],
        },
        { label: null, members: [] },
      ],
    };
    expect(stripOptionalNulls(data, schema)).toEqual({
      groups: [
        {
          label: 'A',
          members: [{ id: 'm1' }, { id: null, role: 'scout' }],
        },
        { label: null, members: [] },
      ],
    });
  });

  it('the stripping validator removes an unnamed key on a nested object', () => {
    const reply = JSON.parse(VALID_DM_REPLY);
    const nested = {
      ...reply,
      combatants: [{ monster_id: 'goblin-1', name: 'Goblin', count: 1, hp: 7 }],
    };
    const normalized = JSON.parse(validateToolReplyText(JSON.stringify(nested), dmResponseSchema));
    expect(normalized.combatants).toEqual([{ monster_id: 'goblin-1', name: 'Goblin', count: 1 }]);
    expect(normalized.text).toBe(reply.text);
  });

  it('the stripping validator still rejects a missing required key', () => {
    const { options: _omitted, ...missingOptions } = JSON.parse(VALID_DM_REPLY);
    expect(() => validateToolReplyText(JSON.stringify(missingOptions), dmResponseSchema)).toThrow(
      /does not match schema/,
    );
  });

  it('keeps both combat_actions oneOf branches intact when stripping', () => {
    const reply = {
      ...JSON.parse(VALID_DM_REPLY),
      combat_actions: [
        {
          actor_id: 'p1',
          action_type: 'cast_spell',
          spell_id: 'fireball',
          origin: { x: 1, y: 2 },
          direction: null,
          slot_level: 3,
        },
      ],
    };
    const normalized = JSON.parse(validateToolReplyText(JSON.stringify(reply), dmResponseSchema));
    expect(normalized.combat_actions).toEqual(reply.combat_actions);
  });

  // #783: Haiku sends a nested object as a JSON string on the forced-tool path.
  it('a tool reply with scene_spec sent as a JSON string of a valid object validates and Haiku is served', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
    const sceneSpec = { environment: 'cave', seed: 4 };
    const stringified = { ...JSON.parse(VALID_DM_REPLY), scene_spec: JSON.stringify(sceneSpec) };
    const bodies = stubOpenRouter([{ toolArguments: JSON.stringify(stringified) }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(1);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(JSON.parse(result.text).scene_spec).toEqual(sceneSpec);
  });

  it('a tool reply with scene_spec as a string that is not JSON still fails and falls over', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
    const notJson = { ...JSON.parse(VALID_DM_REPLY), scene_spec: 'a dim cave, cold air' };
    expect(() => validateToolReplyText(JSON.stringify(notJson), dmResponseSchema)).toThrow(
      /does not match schema/,
    );
    const bodies = stubOpenRouter([
      { toolArguments: JSON.stringify(notJson) },
      { toolArguments: JSON.stringify(notJson) },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(3);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
  });

  it('a tool reply with scene_spec as a JSON string of the wrong type still fails and falls over', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
    const wrongType = { ...JSON.parse(VALID_DM_REPLY), scene_spec: JSON.stringify([1, 2]) };
    const bodies = stubOpenRouter([
      { toolArguments: JSON.stringify(wrongType) },
      { toolArguments: JSON.stringify(wrongType) },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(3);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
  });

  it('a tool reply with narration_segments sent as a JSON string is parsed', () => {
    const segments = [{ type: 'dm', text: 'The cave breathes cold air.' }];
    const reply = { ...JSON.parse(VALID_DM_REPLY), narration_segments: JSON.stringify(segments) };
    const normalized = JSON.parse(validateToolReplyText(JSON.stringify(reply), dmResponseSchema));
    expect(normalized.narration_segments).toEqual(segments);
  });

  it('parseStringifiedNested parses only where the schema type matches and walks into the result', () => {
    const schema = {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          properties: { inner: { type: 'object', properties: { n: { type: 'number' } } } },
        },
        items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
        label: { type: 'string' },
        mixed: { anyOf: [{ type: 'object' }, { type: 'string' }] },
      },
    };
    const data = {
      // A JSON string whose own nested field is also a JSON string.
      spec: JSON.stringify({ inner: JSON.stringify({ n: 3 }) }),
      items: JSON.stringify([{ id: 'a' }]),
      label: JSON.stringify({ not: 'a string field' }),
      mixed: JSON.stringify({ kept: true }),
    };
    expect(parseStringifiedNested(data, schema)).toEqual({
      spec: { inner: { n: 3 } },
      items: [{ id: 'a' }],
      label: JSON.stringify({ not: 'a string field' }),
      mixed: JSON.stringify({ kept: true }),
    });
    // Unparseable and wrong-type strings are returned unchanged.
    expect(parseStringifiedNested('{broken', { type: 'object' })).toBe('{broken');
    expect(parseStringifiedNested('[1]', { type: 'object' })).toBe('[1]');
  });

  // #783 (Refs #783): Haiku writes the literal string "null" for optional object/array fields.
  it('a tool reply with the string "null" on optional object and array fields validates, drops them, and Haiku is served', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const stringNulls = {
      ...JSON.parse(VALID_DM_REPLY),
      scene_spec: 'null',
      xp_award: 'null',
      damage: 'null',
      items: 'null',
      rest: 'null',
    };
    const bodies = stubOpenRouter([{ toolArguments: JSON.stringify(stringNulls) }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(1);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    const reply = JSON.parse(result.text);
    for (const key of ['scene_spec', 'xp_award', 'damage', 'items', 'rest']) {
      expect(reply).not.toHaveProperty(key);
    }
    expect(reply.text).toBe(JSON.parse(VALID_DM_REPLY).text);
  });

  it('a tool reply with a REQUIRED key set to the string "null" still fails and falls over', async () => {
    useModel('anthropic/claude-haiku-5.5');
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
    const stringRequired = { ...JSON.parse(VALID_DM_REPLY), options: 'null' };
    expect(() => validateToolReplyText(JSON.stringify(stringRequired), dmResponseSchema)).toThrow(
      /does not match schema/,
    );
    const bodies = stubOpenRouter([
      { toolArguments: JSON.stringify(stringRequired) },
      { toolArguments: JSON.stringify(stringRequired) },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.error).toBeUndefined();
    expect(bodies).toHaveLength(3);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
  });

  it('parseStringifiedNested maps the string "null", "", and whitespace-padded "null" to null on object and array schemas only', () => {
    const schema = {
      type: 'object',
      properties: {
        obj: { type: 'object', properties: { a: { type: 'string' } } },
        arr: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
      },
    };
    expect(parseStringifiedNested({ obj: 'null', arr: '', label: 'null' }, schema)).toEqual({
      obj: null,
      arr: null,
      label: 'null',
    });
    expect(parseStringifiedNested({ obj: ' null ', arr: '   ' }, schema)).toEqual({
      obj: null,
      arr: null,
    });
    expect(parseStringifiedNested('null', { type: 'object' })).toBeNull();
    expect(parseStringifiedNested('', { type: 'string' })).toBe('');
  });

  it('a failed tool-path validation logs the first error path, value type and a 200-char slice', () => {
    const warn = spyOn(logger, 'warn');
    try {
      const longSentence = 'x'.repeat(500);
      const reply = { ...JSON.parse(VALID_DM_REPLY), scene_spec: `${longSentence}` };
      expect(() => validateToolReplyText(JSON.stringify(reply), dmResponseSchema)).toThrow(
        /does not match schema/,
      );
      const call = warn.mock.calls.find(
        ([payload]) => (payload as { msg?: string }).msg === 'LLM_TOOL_SCHEMA_INVALID',
      );
      expect(call).toBeDefined();
      const payload = call?.[0] as Record<string, unknown>;
      expect(payload.instancePath).toBe('/scene_spec');
      expect(payload.valueType).toBe('string');
      expect(payload.valueHead).toBe('x'.repeat(200));
      expect(String(payload.valueHead).length).toBeLessThanOrEqual(200);
    } finally {
      warn.mockRestore();
    }
  });

  it('schemaDelivery overrides keep strictJsonSchema in agreement', () => {
    process.env.LLM_VENDOR_CAPABILITIES = '{"anthropic/": {"schemaDelivery": "strict"}}';
    const strict = getVendorCapabilityProfile('anthropic/claude-haiku-5.5');
    expect(strict.schemaDelivery).toBe('strict');
    expect(strict.strictJsonSchema).toBe(true);

    process.env.LLM_VENDOR_CAPABILITIES = '{"google/": {"schemaDelivery": "tool"}}';
    const tool = getVendorCapabilityProfile('google/gemini-3.1-flash-lite');
    expect(tool.schemaDelivery).toBe('tool');
    expect(tool.strictJsonSchema).toBe(false);

    process.env.LLM_VENDOR_CAPABILITIES = '{"anthropic/": {"schemaDelivery": "bogus"}}';
    expect(getVendorCapabilityProfile('anthropic/claude-haiku-5.5').schemaDelivery).toBe('tool');
  });

  it('the default table gives anthropic/ the tool path and every other known vendor its strict/instructed path', () => {
    expect(getVendorCapabilityProfile('anthropic/claude-haiku-5.5').schemaDelivery).toBe('tool');
    expect(getVendorCapabilityProfile('google/gemini-3.1-flash-lite').schemaDelivery).toBe(
      'strict',
    );
    expect(getVendorCapabilityProfile('xai/grok-4').schemaDelivery).toBe('instructed');
  });
});

describe('#875 narration normalization on every schema path', () => {
  const story = 'You shift your grip on the rope and look down into the dark.';
  const appendix = '\noptions: ["A. Climb down", "B. Call out", "C. Wait"]';
  const replyWith = (text: string, options: string[] = []): string =>
    JSON.stringify({ ...JSON.parse(VALID_DM_REPLY), text, options });
  // The D20-020 shape: a whole reply serialized into the text field.
  const nestedReply = (innerOptions: string[]): string =>
    replyWith(replyWith(story, innerOptions), []);

  it('strips an options appendix inside text on the strict path', async () => {
    useModel('openai/gpt-5-mini');
    stubOpenRouter([{ content: replyWith(story + appendix, ['A. Climb down']) }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Climb down']);
  });

  it('strips an options appendix inside text on the instructed path', async () => {
    useModel('xai/grok-4');
    stubOpenRouter([{ content: replyWith(story + appendix, ['A. Climb down']) }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Climb down']);
  });

  it('strips an options appendix inside text on the Gemini path', async () => {
    process.env.GOOGLE_GEMINI_API_KEY = 'gemini-test';
    process.env.GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: replyWith(story + appendix, ['A. Climb down']) }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 40, totalTokenCount: 49 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      provider: 'gemini',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Climb down']);
  });

  it('unwraps an envelope nested inside text on the tool path and adopts its options', async () => {
    useModel('anthropic/claude-haiku-5.5');
    stubOpenRouter([{ toolArguments: nestedReply(['A. Climb down', 'B. Call out']) }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Climb down', 'B. Call out']);
  });

  it('unwraps an envelope nested inside text on the strict path', async () => {
    useModel('openai/gpt-5-mini');
    stubOpenRouter([{ content: nestedReply(['A. Climb down']) }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Climb down']);
  });

  it('keeps the outer options when a nested envelope is unwrapped', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const outer = JSON.stringify({
      ...JSON.parse(VALID_DM_REPLY),
      text: replyWith(story, ['A. Inner']),
      options: ['A. Outer'],
    });
    stubOpenRouter([{ toolArguments: outer }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Outer']);
  });

  it('strips the appendix from the inner text after unwrapping', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const outer = replyWith(replyWith(story + appendix, []), []);
    stubOpenRouter([{ toolArguments: outer }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
  });

  it('leaves a clean strict reply byte-identical', async () => {
    useModel('openai/gpt-5-mini');
    const clean = replyWith(story, ['A. Climb down']);
    stubOpenRouter([{ content: clean }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(result.text).toBe(clean);
  });

  it('adopts the inner mechanical fields the outer shell left empty', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const inner = {
      ...JSON.parse(VALID_DM_REPLY),
      text: 'The goblin lunges from the dark.',
      options: ['A. Dodge'],
      combat_transition: 'start',
      roll_requests: [
        {
          type: 'attack',
          formula: '1d20+4',
          purpose: 'Goblin scimitar attack',
          dc: null,
          ac: 15,
          advantage: false,
          disadvantage: false,
        },
      ],
      combat_actions: [{ actor: 'Goblin', action_type: 'attack' }],
      combatants: [{ name: 'Goblin', hp: 7, max_hp: 7, ac: 15 }],
    };
    // The outer reply is a shell: VALID_DM_REPLY defaults everywhere else.
    const outer = replyWith(JSON.stringify(inner), []);
    stubOpenRouter([{ toolArguments: outer }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    const envelope = JSON.parse(result.text);
    expect(envelope.text).toBe('The goblin lunges from the dark.');
    expect(envelope.options).toEqual(['A. Dodge']);
    expect(envelope.combat_transition).toBe('start');
    expect(envelope.roll_requests).toHaveLength(1);
    expect(envelope.combat_actions).toHaveLength(1);
    expect(envelope.combatants).toHaveLength(1);
  });

  it('keeps the outer mechanical fields when the outer reply set them', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const outerSave = {
      type: 'save',
      formula: '1d20+2',
      purpose: 'Outer save',
      dc: 13,
      ac: null,
      advantage: false,
      disadvantage: false,
    };
    const inner = {
      ...JSON.parse(VALID_DM_REPLY),
      text: story,
      combat_transition: 'start',
      roll_requests: [
        {
          type: 'attack',
          formula: '1d20+4',
          purpose: 'Inner attack',
          dc: null,
          ac: 15,
          advantage: false,
          disadvantage: false,
        },
      ],
    };
    const outer = {
      ...JSON.parse(VALID_DM_REPLY),
      text: JSON.stringify(inner),
      combat_transition: 'end',
      roll_requests: [outerSave],
    };
    stubOpenRouter([{ toolArguments: JSON.stringify(outer) }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    const envelope = JSON.parse(result.text);
    expect(envelope.text).toBe(story);
    expect(envelope.combat_transition).toBe('end');
    expect(envelope.roll_requests).toEqual([outerSave]);
  });

  it('never empties the narration: an inner text of "" leaves the reply untouched', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const payload = replyWith('', ['A. X']);
    const outer = replyWith(payload, []);
    stubOpenRouter([{ toolArguments: outer }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    const envelope = JSON.parse(result.text);
    expect(envelope.text).toBe(payload);
    expect(envelope.options).toEqual([]);
  });

  it('never empties the narration: an appendix-only inner text leaves the reply untouched', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const payload = replyWith('\noptions: ["A. X"]', []);
    const outer = replyWith(payload, []);
    stubOpenRouter([{ toolArguments: outer }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(payload);
  });

  it('unwraps a doubly nested envelope', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const outer = replyWith(replyWith(replyWith(story, ['A. Deep']), []), []);
    stubOpenRouter([{ toolArguments: outer }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Deep']);
  });

  it('unwraps a fenced envelope nested inside text', async () => {
    useModel('anthropic/claude-haiku-5.5');
    const outer = replyWith('```json\n' + replyWith(story, ['A. Fenced']) + '\n```', []);
    stubOpenRouter([{ toolArguments: outer }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Fenced']);
  });

  it('does not unwrap a quoted JSON object that is not reply-shaped', async () => {
    useModel('openai/gpt-5-mini');
    const quoted = '{"text": "The inscription reads: open at dawn."}';
    stubOpenRouter([{ content: replyWith(quoted, []) }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(quoted);
  });

  it('unwraps an envelope nested inside text on the Gemini path', async () => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: nestedReply(['A. Climb down']) }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 40, totalTokenCount: 49 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      provider: 'gemini',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(JSON.parse(result.text).options).toEqual(['A. Climb down']);
  });

  it('strips the appendix from a strict reply that fails the full schema (shadow-kept)', async () => {
    useModel('openai/gpt-5-mini');
    // Text-valid but missing most required keys: shadow mode keeps it, and
    // normalization still applies to the text that ships.
    const partial = JSON.stringify({ text: story + appendix, combat_transition: 'none' });
    stubOpenRouter([{ content: partial }]);
    const result = await LLMProviderService.generate({
      prompt: 'Continue',
      responseSchema: dmResponseSchema,
    });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.text).text).toBe(story);
    expect(result.usage?.schemaShadowInvalid).toBe(1);
  });
});

describe('#782 HOLD item 1: true shadow compares every branch against the phase', () => {
  it('tool path: a full-valid tool reply on a narrative turn logs a phase-only mismatch, and keeps it', async () => {
    useModel('anthropic/claude-haiku-5.5');
    // FIX round 2: the wrong-phase fixture must carry a NON-EMPTY dropped
    // section — empty dropped arrays are padding, not a mismatch, so
    // VALID_DM_REPLY on its own no longer mismatches (see the next test).
    const reply = JSON.stringify({
      ...JSON.parse(VALID_DM_REPLY),
      combat_actions: [NON_EMPTY_COMBAT_ACTION],
    });
    const bodies = stubOpenRouter([{ toolArguments: reply }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'narrative',
        maxTokens: 100,
      });

      // The request schema is today's full schema; the tool arguments are
      // valid under it (stripping keeps every named key). The phase
      // comparison sees the arguments with full-named keys intact — the
      // non-empty dropped section is still there — so it logs the
      // mismatch instead of swallowing it.
      expect(bodies).toHaveLength(1);
      expect(result.error).toBeUndefined();
      expect(result.text).toBe(reply);
      expect(result.usage?.schemaDelivery).toBe('forced-tool-call');
      // The forced-tool parameters serialize byte-for-byte to main's schema:
      // the request is today's schema, not the phase schema, on this path too.
      const tools = (bodies[0] as unknown as Body).tools as {
        function: { parameters: unknown };
      }[];
      expect(JSON.stringify(tools[0].function.parameters)).toBe(
        JSON.stringify(mainDmResponseSchema),
      );
      expect(result.usage?.schemaShadowInvalid).toBe(1);
      const calls = warn.mock.calls.map(
        (call) => call[0] as { msg?: string; phase?: string; additionalProperty?: string },
      );
      const shadow = calls.find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID');
      expect(shadow?.phase).toBe('narrative');
      // The log names the offending key: the non-empty dropped section.
      expect(shadow?.additionalProperty).toBe('combat_actions');
      // No tool failure: the reply is valid under today's full schema.
      expect(calls.find((entry) => entry?.msg === 'LLM_TOOL_SCHEMA_INVALID')).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('tool path: a narrative turn padded with empty dropped sections is not a phase mismatch', async () => {
    // #782 FIX at a430d910: every full-valid reply carries combat_actions
    // and map_actions (both full-required), so counting empty dropped
    // sections would fire the counter on nearly every narrative turn and
    // the zero-invalid flip gate could never be met. Empty dropped
    // sections are removed before validation; only a non-empty one flags.
    useModel('anthropic/claude-haiku-5.5');
    const bodies = stubOpenRouter([{ toolArguments: VALID_DM_REPLY }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'narrative',
        maxTokens: 100,
      });

      expect(bodies).toHaveLength(1);
      expect(result.error).toBeUndefined();
      expect(result.text).toBe(VALID_DM_REPLY);
      expect(result.usage?.schemaDelivery).toBe('forced-tool-call');
      expect(result.usage?.schemaShadowInvalid).toBeUndefined();
      const calls = warn.mock.calls.map((call) => call[0] as { msg?: string });
      expect(calls.find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID')).toBeUndefined();
      expect(calls.find((entry) => entry?.msg === 'LLM_TOOL_SCHEMA_INVALID')).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('tool path: a combat turn padded with an empty dropped section is not a phase mismatch', async () => {
    // Combat drops only map_actions; VALID_DM_REPLY carries it empty, so
    // the comparison removes it and the reply is combat-clean. combat_actions
    // (empty) is combat-kept, not dropped, so nothing else changes.
    useModel('anthropic/claude-haiku-5.5');
    const bodies = stubOpenRouter([{ toolArguments: VALID_DM_REPLY }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'combat',
        maxTokens: 100,
      });

      expect(bodies).toHaveLength(1);
      expect(result.error).toBeUndefined();
      expect(result.text).toBe(VALID_DM_REPLY);
      expect(result.usage?.schemaDelivery).toBe('forced-tool-call');
      expect(result.usage?.schemaShadowInvalid).toBeUndefined();
      const calls = warn.mock.calls.map((call) => call[0] as { msg?: string });
      expect(calls.find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID')).toBeUndefined();
      expect(calls.find((entry) => entry?.msg === 'LLM_TOOL_SCHEMA_INVALID')).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('tool path: a phase-clean tactical tool reply with one unnamed root key is kept, with no phase mismatch', async () => {
    // #782 FIX at 87c8e32f: the phase comparison ignores keys the full
    // schema does not declare. A tactical-clean reply carrying one
    // #783-tolerated extra key (visual_prompt) is phase-clean once that
    // key is ignored, so it must not log or count as a phase mismatch.
    // (A narrative version of this test cannot exist: a narrative-clean
    // reply omits the fight arrays, which the full schema requires, so
    // the tool path would reject it before any comparison runs. Tactical
    // is the phase where full-valid and phase-clean coexist.)
    useModel('anthropic/claude-haiku-5.5');
    const withExtra = JSON.stringify({ ...JSON.parse(VALID_DM_REPLY), visual_prompt: 'a lantern' });
    const bodies = stubOpenRouter([{ toolArguments: withExtra }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'tactical',
        maxTokens: 100,
      });

      expect(bodies).toHaveLength(1);
      expect(result.error).toBeUndefined();
      // The extra key is stripped from the shipped text, as on #783.
      expect(result.text).toBe(VALID_DM_REPLY);
      expect(result.usage?.schemaDelivery).toBe('forced-tool-call');
      expect(result.usage?.schemaShadowInvalid).toBeUndefined();
      const calls = warn.mock.calls.map((call) => call[0] as { msg?: string });
      expect(calls.find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID')).toBeUndefined();
      expect(calls.find((entry) => entry?.msg === 'LLM_TOOL_SCHEMA_INVALID')).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('tool path: a genuine tactical phase defect is still counted when an unnamed key is also present', async () => {
    // The ignore in the test above must not blind the comparison: a
    // full-named wrong-phase section survives the strip and still counts,
    // and the log names it (not the ignored extra key).
    useModel('anthropic/claude-haiku-5.5');
    const reply = JSON.stringify({
      ...JSON.parse(VALID_DM_REPLY),
      scene_spec: { environment: 'corridor', seed: 7 },
      visual_prompt: 'a lantern',
    });
    const bodies = stubOpenRouter([{ toolArguments: reply }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'volatile user prompt',
        systemPrompt: 'stable system block',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'tactical',
        maxTokens: 100,
      });

      expect(bodies).toHaveLength(1);
      expect(result.error).toBeUndefined();
      // scene_spec ships (it is full-named); only the unnamed key is stripped.
      expect(result.text).toBe(
        JSON.stringify({
          ...JSON.parse(VALID_DM_REPLY),
          scene_spec: { environment: 'corridor', seed: 7 },
        }),
      );
      expect(result.usage?.schemaShadowInvalid).toBe(1);
      const shadow = warn.mock.calls
        .map((call) => call[0] as { msg?: string; phase?: string; additionalProperty?: string })
        .find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID');
      expect(shadow?.phase).toBe('tactical');
      expect(shadow?.additionalProperty).toBe('scene_spec');
      const calls = warn.mock.calls.map((call) => call[0] as { msg?: string });
      expect(calls.find((entry) => entry?.msg === 'LLM_TOOL_SCHEMA_INVALID')).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('strict path: a full-valid strict reply on a narrative turn logs a phase-only mismatch, and keeps it', async () => {
    useModel('openai/gpt-5-mini');
    // FIX round 2: the wrong-phase fixture carries a non-empty dropped
    // section (empty dropped arrays are padding, not a mismatch).
    const reply = JSON.stringify({
      ...JSON.parse(VALID_DM_REPLY),
      combat_actions: [NON_EMPTY_COMBAT_ACTION],
    });
    const bodies = stubOpenRouter([{ content: reply }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    try {
      const result = await LLMProviderService.generate({
        prompt: 'Continue',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'narrative',
      });

      expect(bodies).toHaveLength(1);
      expect(result.error).toBeUndefined();
      expect(result.text).toBe(reply);
      // The strict response_format schema serializes byte-for-byte to main's
      // schema on this path too.
      const schema = (
        (bodies[0] as unknown as Body).response_format as {
          json_schema: { schema: unknown };
        }
      ).json_schema.schema;
      expect(JSON.stringify(schema)).toBe(JSON.stringify(mainDmResponseSchema));
      expect(result.usage?.schemaShadowInvalid).toBe(1);
      const shadow = warn.mock.calls
        .map((call) => call[0] as { msg?: string; phase?: string; additionalProperty?: string })
        .find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID');
      expect(shadow?.phase).toBe('narrative');
      expect(shadow?.additionalProperty).toBe('combat_actions');
    } finally {
      warn.mockRestore();
    }
  });

  it('strict path under LLM_STRICT_BRANCH_VALIDATION=enforce still compares, never hard-fails, a full-valid reply', async () => {
    // The request schema is today's full schema, so enforce mode has nothing
    // new to enforce: a full-valid reply is kept and the phase comparison
    // still logs and counts. (Shadow must hold "with every env value".)
    useModel('openai/gpt-5-mini');
    // FIX round 2: the wrong-phase fixture carries a non-empty dropped
    // section (empty dropped arrays are padding, not a mismatch).
    const reply = JSON.stringify({
      ...JSON.parse(VALID_DM_REPLY),
      combat_actions: [NON_EMPTY_COMBAT_ACTION],
    });
    const bodies = stubOpenRouter([{ content: reply }]);
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    setStrictBranchValidationModeForTests('enforce');
    try {
      const result = await LLMProviderService.generate({
        prompt: 'Continue',
        responseSchema: dmResponseSchema,
        responseSchemaPhase: 'narrative',
      });

      expect(bodies).toHaveLength(1);
      expect(result.error).toBeUndefined();
      expect(result.text).toBe(reply);
      expect(result.usage?.schemaShadowInvalid).toBe(1);
      const shadow = warn.mock.calls
        .map((call) => call[0] as { msg?: string; phase?: string; additionalProperty?: string })
        .find((entry) => entry?.msg === 'LLM_SCHEMA_SHADOW_INVALID');
      expect(shadow?.phase).toBe('narrative');
      expect(shadow?.additionalProperty).toBe('combat_actions');
    } finally {
      warn.mockRestore();
      setStrictBranchValidationModeForTests('shadow');
    }
  });
});
