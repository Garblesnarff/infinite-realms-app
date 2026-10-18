/**
 * LLM_STRICT_BRANCH_VALIDATION (shadow by default). On the strict branch
 * (OpenRouter json_schema candidates, direct Gemini) a reply that passes the
 * text:string check but fails the full DM schema is accepted in shadow mode
 * and logged as LLM_SCHEMA_SHADOW_INVALID. Enforce mode rejects it as #789 did.
 * The Anthropic instructed branch is always a hard full-schema check.
 * No live provider calls: fetch is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
import { dmResponseSchema } from '../dm/dm-response-schema.js';
import {
  LLMProviderService,
  setStrictBranchValidationModeForTests,
} from '../llm-provider-service.js';
import { resetModelHealthForTests } from '../model-health.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => setStrictBranchValidationModeForTests('shadow'));

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  setStrictBranchValidationModeForTests('shadow');
  resetCircuitBreakersForTests();
  resetModelHealthForTests();
});

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

// text:string present, so the hard check passes; roll_requests item is null, so the full schema fails.
const SCHEMA_INVALID_REPLY = JSON.stringify({
  text: 'The lantern flickers over a wet cobblestone street.',
  options: [],
  narration_segments: [],
  roll_requests: [null],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
});

// No text:string at all, so it fails even the hard check.
const NO_TEXT_REPLY = JSON.stringify({ options: [], roll_requests: [] });

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

type Body = { model: string };

const modelsOf = (bodies: Record<string, unknown>[]): string[] =>
  bodies.map((b) => (b as unknown as Body).model);

function useGeminiThenAnthropic(): void {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
  process.env.OPENROUTER_FALLBACK_MODELS = 'anthropic/claude-haiku-5.5';
}

function useAnthropicThenGemini(): void {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
  process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
}

const generate = () =>
  LLMProviderService.generate({
    prompt: 'volatile user prompt',
    systemPrompt: 'stable system block',
    responseSchema: dmResponseSchema,
    maxTokens: 100,
  });

const shadowLogs = (warn: { mock: { calls: unknown[][] } }) =>
  warn.mock.calls.filter(
    (call) => (call[0] as { msg?: string } | undefined)?.msg === 'LLM_SCHEMA_SHADOW_INVALID',
  );

describe('LLM_STRICT_BRANCH_VALIDATION: shadow mode on the strict branch', () => {
  it('(a) accepts a schema-invalid strict-branch reply with no failover and one shadow log', async () => {
    useGeminiThenAnthropic();
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    const bodies = stubOpenRouter([{ content: SCHEMA_INVALID_REPLY }]);

    const result = await generate();

    expect(modelsOf(bodies)).toEqual(['google/gemini-3.1-flash-lite']);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
    expect(result.error).toBeUndefined();
    expect(result.text).toBe(SCHEMA_INVALID_REPLY);
    expect(result.usage?.schemaShadowInvalid).toBe(1);

    const logs = shadowLogs(warn);
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toEqual({
      msg: 'LLM_SCHEMA_SHADOW_INVALID',
      model: 'google/gemini-3.1-flash-lite',
      instancePath: '/roll_requests/0',
      keyword: expect.any(String),
      message: expect.any(String),
    });
    // No reply text in the log line.
    expect(JSON.stringify(logs[0][0])).not.toContain('lantern');
    warn.mockRestore();
  });

  it('(a) leaves usage without a schemaShadowInvalid field for a schema-valid reply', async () => {
    useGeminiThenAnthropic();
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    stubOpenRouter([{ content: VALID_DM_REPLY }]);

    const result = await generate();

    expect(result.usage).not.toHaveProperty('schemaShadowInvalid');
    expect(shadowLogs(warn)).toHaveLength(0);
    warn.mockRestore();
  });

  it('(b) enforce mode rejects the same reply, retries, and fails over', async () => {
    useGeminiThenAnthropic();
    setStrictBranchValidationModeForTests('enforce');
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    const bodies = stubOpenRouter([
      { content: SCHEMA_INVALID_REPLY },
      { content: SCHEMA_INVALID_REPLY },
      { content: VALID_DM_REPLY },
    ]);

    const result = await generate();

    expect(modelsOf(bodies)).toEqual([
      'google/gemini-3.1-flash-lite',
      'google/gemini-3.1-flash-lite',
      'anthropic/claude-haiku-5.5',
    ]);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(result.text).toBe(VALID_DM_REPLY);
    expect(shadowLogs(warn)).toHaveLength(0);
    warn.mockRestore();
  });

  it('(d) still rejects a strict-branch reply with no text:string in shadow mode', async () => {
    useGeminiThenAnthropic();
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    const bodies = stubOpenRouter([
      { content: NO_TEXT_REPLY },
      { content: NO_TEXT_REPLY },
      { content: VALID_DM_REPLY },
    ]);

    const result = await generate();

    expect(modelsOf(bodies)).toEqual([
      'google/gemini-3.1-flash-lite',
      'google/gemini-3.1-flash-lite',
      'anthropic/claude-haiku-5.5',
    ]);
    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    expect(shadowLogs(warn)).toHaveLength(0);
    warn.mockRestore();
  });

  it('(c) the anthropic/ instructed branch still rejects a schema-invalid reply in shadow mode', async () => {
    useAnthropicThenGemini();
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    const bodies = stubOpenRouter([
      { content: SCHEMA_INVALID_REPLY },
      { content: SCHEMA_INVALID_REPLY },
      { content: VALID_DM_REPLY },
    ]);

    const result = await generate();

    // Hard ajv on the instructed branch: two Anthropic attempts, then failover to Gemini.
    expect(modelsOf(bodies)).toEqual([
      'anthropic/claude-haiku-5.5',
      'anthropic/claude-haiku-5.5',
      'google/gemini-3.1-flash-lite',
    ]);
    expect(result.model).toBe('google/gemini-3.1-flash-lite');
    expect(result.text).toBe(VALID_DM_REPLY);
    expect(shadowLogs(warn)).toHaveLength(0);
    warn.mockRestore();
  });
});
