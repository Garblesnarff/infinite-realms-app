/**
 * #633 PR3: the OpenRouter request carries exactly one prompt-cache
 * breakpoint, on the stable system block. No live provider calls: fetch is
 * stubbed and the request body is asserted.
 *
 * The payload is built by the REAL LLMProviderService.generate (OpenRouter
 * path) — not a hand-written copy — so this test fails if the breakpoint is
 * dropped, moved onto a volatile block, or duplicated.
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

function stubOpenRouter(reply: Record<string, unknown>): Array<Record<string, unknown>> {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

const okReply = {
  choices: [{ message: { content: 'You see a kitchen.' } }],
  usage: { prompt_tokens: 9000, completion_tokens: 10, total_tokens: 9010 },
};

type WireMessage = { role: string; content: unknown };

/** Every content block in the request that carries a cache_control marker. */
function cacheControlMarkers(messages: WireMessage[]): Array<{
  role: string;
  cache_control: unknown;
}> {
  const markers: Array<{ role: string; cache_control: unknown }> = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block && typeof block === 'object' && 'cache_control' in block) {
        markers.push({ role: message.role, cache_control: block.cache_control });
      }
    }
  }
  return markers;
}

function stubEnv(): void {
  process.env.OPENROUTER_API_KEY = 'test-key-for-stubbed-provider';
  process.env.OPENROUTER_TEXT_MODEL = 'test/model';
  process.env.OPENROUTER_FALLBACK_MODELS = '';
}

describe('#633 PR3 OpenRouter prompt-cache breakpoint', () => {
  it('puts exactly one ephemeral breakpoint on the stable system block', async () => {
    stubEnv();
    const bodies = stubOpenRouter(okReply);

    await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      maxTokens: 100,
    });

    expect(bodies).toHaveLength(1);
    const messages = (bodies[0] as { messages: WireMessage[] }).messages;
    expect(messages[0]).toEqual({
      role: 'system',
      content: [
        { type: 'text', text: 'stable system block', cache_control: { type: 'ephemeral' } },
      ],
    });
    // Exactly one breakpoint in the whole request (Anthropic allows max 4).
    expect(cacheControlMarkers(messages)).toEqual([
      { role: 'system', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('leaves history and the volatile user message unmarked', async () => {
    stubEnv();
    const bodies = stubOpenRouter(okReply);

    await LLMProviderService.generate({
      prompt: 'volatile user prompt',
      systemPrompt: 'stable system block',
      history: [
        { role: 'user', content: 'earlier player input' },
        { role: 'assistant', content: 'earlier dm reply' },
      ],
      maxTokens: 100,
    });

    const messages = (bodies[0] as { messages: WireMessage[] }).messages;
    // History and the user message stay plain strings: they change every
    // turn, so a breakpoint on them would poison the cached prefix.
    expect(messages[1]).toEqual({ role: 'user', content: 'earlier player input' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'earlier dm reply' });
    expect(messages[3]).toEqual({ role: 'user', content: 'volatile user prompt' });
    expect(cacheControlMarkers(messages)).toHaveLength(1);
    expect(cacheControlMarkers(messages)[0]?.role).toBe('system');
  });

  it('sends no breakpoint when there is no system prompt', async () => {
    stubEnv();
    const bodies = stubOpenRouter(okReply);

    await LLMProviderService.generate({ prompt: 'hello', maxTokens: 100 });

    const messages = (bodies[0] as { messages: WireMessage[] }).messages;
    expect(messages.map((message) => message.role)).toEqual(['user']);
    expect(cacheControlMarkers(messages)).toHaveLength(0);
  });

  it('keeps the marked system block byte-identical across calls', async () => {
    // The provider only serves the cached prefix when it is byte-identical;
    // two turns with the same stable block must serialize identically.
    stubEnv();
    const bodies = stubOpenRouter(okReply);

    await LLMProviderService.generate({
      prompt: 'first volatile prompt',
      systemPrompt: 'stable system block',
      maxTokens: 100,
    });
    await LLMProviderService.generate({
      prompt: 'second volatile prompt',
      systemPrompt: 'stable system block',
      maxTokens: 100,
    });

    expect(bodies).toHaveLength(2);
    const first = (bodies[0] as { messages: WireMessage[] }).messages[0];
    const second = (bodies[1] as { messages: WireMessage[] }).messages[0];
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(cacheControlMarkers([first, second])).toHaveLength(2);
  });
});
