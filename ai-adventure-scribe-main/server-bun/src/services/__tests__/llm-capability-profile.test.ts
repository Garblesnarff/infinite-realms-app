/**
 * #782 item 4: vendor capability profile for DM schema delivery.
 * The table replaces the scattered modelSupportsStrictSchema conditional;
 * unknown vendors get the conservative fallback (instructions + ajv).
 * No live provider calls: fetch is stubbed.
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
import { dmResponseSchema } from '../dm/dm-response-schema.js';
import { getVendorCapabilityProfile, modelSupportsStrictSchema } from '../llm-model-config.js';
import { LLMProviderService } from '../llm-provider-service.js';
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
  scene_spec: null,
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
  max_tokens?: number;
  temperature?: number;
  usage?: unknown;
  stream?: boolean;
  response_format?: unknown;
  provider?: unknown;
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

  it('anthropic/ keeps the schema-as-instructions system block byte-identical', async () => {
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
    expect(body.response_format).toBeUndefined();
    // #783: the instructed path sends no provider routing and no temperature.
    expect('provider' in body).toBe(false);
    expect('temperature' in body).toBe(false);
    expect(systemText(body)).toBe(
      `stable system block\n\n${SCHEMA_INSTRUCTION_LINE}\n${JSON.stringify(dmResponseSchema)}`,
    );
    expect(result.usage?.schemaDelivery).toBe('schema-as-instructions');
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
    // fell through to the instructed candidate.
    expect(bodies.length).toBe(3);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    // require_parameters rides only on the strict json_schema attempts (the
    // two refused google/ calls). The instructed anthropic/ attempt has none (#783).
    expect((bodies[0] as Body).provider).toEqual({ require_parameters: true });
    expect((bodies[1] as Body).provider).toEqual({ require_parameters: true });
    expect('provider' in (bodies[2] as Body)).toBe(false);
    expect('temperature' in (bodies[2] as Body)).toBe(false);
    // The winning candidate's delivery path is logged on the usage object.
    expect(result.usage?.schemaDelivery).toBe('schema-as-instructions');
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
