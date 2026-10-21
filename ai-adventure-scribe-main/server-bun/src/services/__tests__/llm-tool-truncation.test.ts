import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { logger } from '../../lib/logger.js';
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

describe('#922 truncated forced-tool replies', () => {
  for (const stream of [false, true]) {
    for (const finishReason of ['length', 'max_tokens']) {
      it(`logs before invalid tool JSON is discarded (stream=${stream}, finish=${finishReason})`, async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        process.env.OPENROUTER_TEXT_MODEL = 'anthropic/claude-haiku-5.5';
        process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemini-3.1-flash-lite';
        const warn = spyOn(logger, 'warn').mockImplementation(() => {});
        const cut = '{"text":"unfinished';
        globalThis.fetch = (async (_url, init) => {
          const request = JSON.parse(String(init?.body));
          if (!request.model.startsWith('anthropic/'))
            return new Response(
              JSON.stringify({
                choices: [{ message: { content: '{"text":"complete"}' }, finish_reason: 'stop' }],
              }),
              { headers: { 'content-type': 'application/json' } },
            );
          if (stream)
            return new Response(
              `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: cut } }] }, finish_reason: finishReason }], usage: { completion_tokens: 256 } })}\n\ndata: [DONE]\n\n`,
              { headers: { 'content-type': 'text/event-stream' } },
            );
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [{ function: { name: 'dm_reply', arguments: cut } }],
                  },
                  finish_reason: finishReason,
                },
              ],
              usage: { completion_tokens: 256 },
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        }) as typeof fetch;
        try {
          await LLMProviderService.generate({
            prompt: 'fixture turn',
            maxTokens: 256,
            responseSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
              additionalProperties: false,
            },
            ...(stream ? { onToken: () => {} } : {}),
          });
          const logs = warn.mock.calls
            .map((call) => call[0] as unknown as Record<string, unknown>)
            .filter((entry) => entry?.msg === 'LLM_REPLY_TRUNCATED');
          expect(logs).toContainEqual(
            expect.objectContaining({
              provider: 'openrouter',
              model: 'anthropic/claude-haiku-5.5',
              finishReason,
              maxTokens: 256,
              outputTokens: 256,
            }),
          );
          expect(JSON.stringify(logs)).not.toContain(cut);
        } finally {
          warn.mockRestore();
        }
      });
    }
  }
});
