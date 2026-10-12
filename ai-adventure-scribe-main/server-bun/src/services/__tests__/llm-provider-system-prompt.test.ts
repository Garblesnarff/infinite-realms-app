/**
 * #352: the provider sends the stable system block as the `system` message,
 * asks OpenRouter for usage details, and surfaces cached prompt tokens.
 * No live provider calls: fetch is stubbed.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
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

function stubOpenRouter(reply: Record<string, unknown>) {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

describe('#352 OpenRouter system message and cache accounting', () => {
  it('prepends the system message and asks for usage details', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'test/model';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    const bodies = stubOpenRouter({
      choices: [{ message: { content: 'You see a kitchen.' } }],
      usage: { prompt_tokens: 5000, completion_tokens: 50, total_tokens: 5050 },
    });

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      maxTokens: 100,
    });

    expect(bodies).toHaveLength(1);
    const body = bodies[0] as {
      messages: { role: string; content: string }[];
      usage: unknown;
    };
    expect(body.messages[0]).toEqual({ role: 'system', content: 'stable system block' });
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'volatile user prompt' });
    expect(body.usage).toEqual({ include: true });
    expect(result.provider).toBe('openrouter');
  });

  it('surfaces cached prompt tokens from prompt_tokens_details', async () => {
process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'test/model';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    stubOpenRouter({
      choices: [{ message: { content: 'You see a kitchen.' } }],
      usage: {
        prompt_tokens: 12000,
        completion_tokens: 120,
        total_tokens: 12120,
        prompt_tokens_details: { cached_tokens: 9800, cache_write_tokens: 200 },
      },
    });

    const result = await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      maxTokens: 100,
    });

    expect(result.usage).toMatchObject({
      inputTokens: 12000,
      cachedInputTokens: 9800,
      cacheWriteTokens: 200,
    });
  });

  it('sends no system message when the caller omits it (older clients)', async () => {
process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
    process.env.OPENROUTER_TEXT_MODEL = 'test/model';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    const bodies = stubOpenRouter({
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    });

    await LLMProviderService.generate({ prompt: 'hello', maxTokens: 100 });

    const body = bodies[0] as { messages: { role: string }[] };
    expect(body.messages.map((m) => m.role)).toEqual(['user']);
  });
});
