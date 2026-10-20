/**
 * #782 item 2: ajv on every path. Gemini replies (OpenRouter strict branch and
 * the direct Gemini provider) are validated against the full DM schema, not
 * just the text:string check. Invalid → retry → failover, like Anthropic.
 * No live provider calls: fetch is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
import { dmResponseSchema } from '../dm/dm-response-schema.js';
import {
  LLMProviderService,
  setStrictBranchValidationModeForTests,
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

// A current envelope: passes the full schema (proven by the #633 instructed-branch tests).
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

// text:string only, missing every other required top-level section.
const MISSING_SECTIONS_REPLY = JSON.stringify({
  text: 'The lantern flickers.',
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
  response_format?: unknown;
};

function useGeminiThenAnthropic(): void {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
  process.env.OPENROUTER_FALLBACK_MODELS = 'anthropic/claude-haiku-5.5';
}

describe('#782 item 2: full-schema validation on the Gemini (strict) path', () => {
  // #789 behaviour: the strict branch is a hard full-schema check. The default
  // mode is shadow (see llm-provider-strict-shadow.test.ts), so pin enforce here.
  beforeEach(() => setStrictBranchValidationModeForTests('enforce'));
  afterEach(() => setStrictBranchValidationModeForTests('shadow'));

  it('accepts a current envelope for google/gemini-3.1-flash-lite', async () => {
    useGeminiThenAnthropic();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    expect(result.model).toBe('google/gemini-3.1-flash-lite');
    expect(result.error).toBeUndefined();
    expect(result.text).toBe(VALID_DM_REPLY);
    // Request body unchanged: strict json_schema still sent.
    const body = bodies[0] as unknown as Body;
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'structured_response', strict: true, schema: dmResponseSchema },
    });
  });

  it('rejects a legacy null-padded envelope (scene_spec: null), retries, then fails over', async () => {
    // #782 item 7: scene_spec is a plain optional now — a model still padding
    // it with null fails the hard full-schema check, so the retry/failover
    // path fires instead of the turn going through.
    useGeminiThenAnthropic();
    const LEGACY_NULL_REPLY = JSON.stringify({ ...JSON.parse(VALID_DM_REPLY), scene_spec: null });
    const bodies = stubOpenRouter([
      { content: LEGACY_NULL_REPLY },
      { content: LEGACY_NULL_REPLY },
      { content: VALID_DM_REPLY },
    ]);

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    // Two attempts on Gemini (retry), then failover to Anthropic.
    expect(bodies.map((b) => (b as unknown as Body).model)).toEqual([
      'google/gemini-3.1-flash-lite',
      'google/gemini-3.1-flash-lite',
      'anthropic/claude-haiku-5.5',
    ]);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(result.error).toBeUndefined();
    expect(result.text).toBe(VALID_DM_REPLY);
  });

  it('rejects a text-only reply missing required sections, retries, then fails over', async () => {
    useGeminiThenAnthropic();
    const bodies = stubOpenRouter([
      { content: MISSING_SECTIONS_REPLY },
      { content: MISSING_SECTIONS_REPLY },
      { content: VALID_DM_REPLY },
    ]);    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    // Two attempts on Gemini (retry), then failover to Anthropic.
    expect(bodies.map((b) => (b as unknown as Body).model)).toEqual([
      'google/gemini-3.1-flash-lite',
      'google/gemini-3.1-flash-lite',
      'anthropic/claude-haiku-5.5',
    ]);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(result.error).toBeUndefined();
    expect(result.text).toBe(VALID_DM_REPLY);
  });

  it('still sends the identical request body as before (no request change)', async () => {
    useGeminiThenAnthropic();
    const bodies = stubOpenRouter([{ content: VALID_DM_REPLY }]);

    await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      responseSchema: dmResponseSchema,
      maxTokens: 100,
    });

    const body = bodies[0] as unknown as Body;
    // Strict schema in the request; original system messages untouched.
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
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'volatile user prompt' });
  });
});
