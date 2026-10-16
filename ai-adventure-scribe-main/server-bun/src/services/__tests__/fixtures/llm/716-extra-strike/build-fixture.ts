/**
 * Writes the #716 fixture with the real producer, `llmFetch`'s LLM_RECORD_DIR branch, over a
 * stubbed OpenRouter chat-completion response. No network, no provider key.
 *
 *   cd server-bun && bun src/services/__tests__/fixtures/llm/716-extra-strike/build-fixture.ts
 */
import { DM_REQUEST } from './dm-request';
import { LLMProviderService } from '../../../../llm-provider-service.js';

/** Hark QA D5-029 (build 68c3b1db): one engine HIT, HP 5/7, prose with a second strike. */
const DM_PROSE =
  "Captain Reeves's blade flashes out and catches you across the forearm, a hot line of pain. " +
  'Before you can recover your footing, a second strike lands against your shoulder and drives ' +
  'you back a step toward the shelves. The Scholar, what do you do?';

process.env.LLM_RECORD_DIR = import.meta.dir;
delete process.env.LLM_FIXTURE_DIR;
process.env.OPENROUTER_API_KEY = 'record-stub';
globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({
      id: 'gen-716-stub',
      object: 'chat.completion',
      model: DM_REQUEST.model,
      choices: [
        { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: DM_PROSE } },
      ],
      usage: { prompt_tokens: 812, completion_tokens: 61, total_tokens: 873 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch;

const reply = await LLMProviderService.generate(DM_REQUEST);
console.log(reply.error ? `failed: ${reply.error}` : 'fixture written');
