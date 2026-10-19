/**
 * #750 step 2: log the provider finish reason when a reply is cut.
 *
 * LLMProviderService now reads `choices[0].finish_reason` (OpenRouter
 * non-stream and stream) and `candidates[0].finishReason` (Gemini) and warns
 * `LLM_REPLY_TRUNCATED` when the reason means the output hit the token
 * ceiling. No live provider calls: fetch is stubbed.
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { logger } from '../../lib/logger.js';
import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
import { isTruncatedFinishReason, LLMProviderService } from '../llm-provider-service.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetCircuitBreakersForTests();
});

const truncatedLogs = (warn: { mock: { calls: unknown[][] } }): Record<string, unknown>[] =>
  warn.mock.calls
    .map((call) => call[0] as Record<string, unknown> | undefined)
    .filter((entry): entry is Record<string, unknown> => entry?.msg === 'LLM_REPLY_TRUNCATED');

const stubOpenRouter = (body: unknown): void => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_TEXT_MODEL = 'test/model';
  process.env.OPENROUTER_FALLBACK_MODELS = '';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
};

const sse = (chunks: unknown[]): string =>
  `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;

describe('isTruncatedFinishReason', () => {
  it('is true for the truncating reasons whatever the case', () => {
    for (const reason of ['length', 'max_tokens', 'MAX_TOKENS', 'Max_Tokens']) {
      expect(isTruncatedFinishReason(reason)).toBe(true);
    }
  });

  it('is false for a normal stop and for missing values', () => {
    for (const reason of ['stop', 'end_turn', 'STOP', '', null, undefined]) {
      expect(isTruncatedFinishReason(reason)).toBe(false);
    }
  });
});

describe('#750 step 2: LLM_REPLY_TRUNCATED', () => {
  it('warns with finishReason on an OpenRouter non-stream reply cut at length', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    stubOpenRouter({
      choices: [{ message: { content: 'a reply cut off mid sent' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 },
    });

    const result = await LLMProviderService.generate({ prompt: 'hello', maxTokens: 25 });

    expect(result.text).toBe('a reply cut off mid sent');
    const logs = truncatedLogs(warn);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      msg: 'LLM_REPLY_TRUNCATED',
      provider: 'openrouter',
      model: 'test/model',
      finishReason: 'length',
      maxTokens: 25,
      outputTokens: 20,
    });
    // Never logs reply text.
    expect(JSON.stringify(logs[0])).not.toContain('cut off');
    warn.mockRestore();
  });

  it('does not warn on an OpenRouter non-stream stop reply', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    stubOpenRouter({
      choices: [{ message: { content: 'a complete reply' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
    });

    const result = await LLMProviderService.generate({ prompt: 'hello' });

    expect(result.text).toBe('a complete reply');
    expect(truncatedLogs(warn)).toHaveLength(0);
    warn.mockRestore();
  });

  it('warns on the OpenRouter stream path when the final chunk reports length', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'test/model';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    const body = sse([
      { choices: [{ delta: { content: 'streamed and cut' }, finish_reason: null }] },
      {
        choices: [{ delta: {}, finish_reason: 'length' }],
        usage: { prompt_tokens: 8, completion_tokens: 30, total_tokens: 38 },
      },
    ]);
    globalThis.fetch = (async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;

    const chunks: string[] = [];
    const result = await LLMProviderService.generate({
      prompt: 'hello',
      maxTokens: 30,
      onToken: (delta) => chunks.push(delta),
    });

    expect(result.text).toBe('streamed and cut');
    expect(chunks).toEqual(['streamed and cut']);
    const logs = truncatedLogs(warn);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider: 'openrouter',
      model: 'test/model',
      finishReason: 'length',
      maxTokens: 30,
      outputTokens: 30,
    });
    warn.mockRestore();
  });

  it('warns for an OpenRouter-routed Anthropic reply that reports max_tokens', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
    process.env.OPENROUTER_FALLBACK_MODELS = '';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'a haiku reply cut off' }, finish_reason: 'max_tokens' }],
          usage: { prompt_tokens: 6, completion_tokens: 15, total_tokens: 21 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({ prompt: 'hello', maxTokens: 15 });

    expect(result.model).toBe('anthropic/claude-haiku-5.5');
    const logs = truncatedLogs(warn);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-5.5',
      finishReason: 'max_tokens',
      maxTokens: 15,
    });
    warn.mockRestore();
  });

  it('warns on the Gemini path when candidates[0].finishReason is MAX_TOKENS', async () => {
    const warn = spyOn(logger, 'warn').mockImplementation((() => {}) as typeof logger.warn);
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: 'a gemini reply cut off' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 40, totalTokenCount: 49 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({
      prompt: 'hello',
      provider: 'gemini',
      maxTokens: 40,
    });

    expect(result.text).toBe('a gemini reply cut off');
    const logs = truncatedLogs(warn);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      finishReason: 'MAX_TOKENS',
      maxTokens: 40,
      outputTokens: 40,
    });
    warn.mockRestore();
  });
});
