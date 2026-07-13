import { afterEach, describe, expect, it } from 'vitest';

import { createUpstreamModelErrorBody, toUpstreamModelError } from '../llm-errors.js';
import { getConfiguredOpenRouterModels } from '../llm-model-config.js';
import { LLMProviderService } from '../llm-provider-service.js';
import { getCircuitBreaker, resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
import {
  getModelHealthStatus,
  resetModelHealthForTests,
  validateConfiguredModels,
} from '../model-health.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetCircuitBreakersForTests();
  resetModelHealthForTests();
});

describe('LLM provider resilience', () => {
  it('maps an upstream 404 to a client-safe 502 body', () => {
    const body = toUpstreamModelError({
      text: '',
      error: 'LLM request failed',
      provider: 'openrouter',
      model: 'stale/model',
      upstreamStatus: 404,
    });
    expect(body).toEqual(createUpstreamModelErrorBody('openrouter', 'stale/model', 404, false));
  });

  it('traverses the OpenRouter fallback chain and succeeds without tripping the breaker', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'stale/model';
    process.env.OPENROUTER_FALLBACK_MODELS = 'fallback/one,fallback/two';
    process.env.CB_FAILURE_THRESHOLD = '1';
    resetCircuitBreakersForTests();
    const requestedModels: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);
      if (body.model === 'stale/model') return new Response('not found', { status: 404 });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'fallback response' } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({ prompt: 'hello' });

    expect(requestedModels).toEqual(['stale/model', 'fallback/one']);
    expect(result).toMatchObject({
      text: 'fallback response',
      model: 'fallback/one',
      provider: 'openrouter',
    });
    expect(() => getCircuitBreaker('llm:openrouter').allowOrThrow()).not.toThrow();
  });

  it('retries invalid structured output once on the same model before falling back', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'broken/structured-model';
    process.env.OPENROUTER_FALLBACK_MODELS = 'fallback/structured-model';
    const requests: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; response_format?: unknown };
      requests.push(body.model);
      if (body.model === 'broken/structured-model') {
        return new Response('not json soup', { status: 200 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: 'valid response' }) } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({
      prompt: 'hello',
      responseSchema: { type: 'object', properties: { text: { type: 'string' } } },
    });

    expect(requests).toEqual(['broken/structured-model', 'broken/structured-model', 'fallback/structured-model']);
    expect(result).toMatchObject({ text: JSON.stringify({ text: 'valid response' }), model: 'fallback/structured-model' });
  });

  it('trips the circuit breaker only after the complete fallback chain fails', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'stale/model';
    process.env.OPENROUTER_FALLBACK_MODELS = 'fallback/one';
    process.env.CB_FAILURE_THRESHOLD = '1';
    resetCircuitBreakersForTests();
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const first = await LLMProviderService.generate({ prompt: 'hello' });
    const second = await LLMProviderService.generate({ prompt: 'hello' });

    expect(requestCount).toBe(2);
    expect(first).toMatchObject({ status: 404, upstreamStatus: 404, provider: 'openrouter' });
    expect(second).toMatchObject({ status: 503 });
  });

  it('reports an unlisted configured model as degraded health', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'stale/model';
    process.env.OPENROUTER_FALLBACK_MODELS = 'listed/model';
    const listedModels = getConfiguredOpenRouterModels()
      .filter((model) => model !== 'stale/model')
      .map((id) => ({ id }));
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: listedModels }), {
        status: 200,
      })) as unknown as typeof fetch;

    const health = await validateConfiguredModels();

    expect(health.status).toBe('degraded');
    expect(health.openrouter.unlistedModels).toContain('stale/model');
    expect(getModelHealthStatus().status).toBe('degraded');
  });

  it('reports a listed model without structured output capability as degraded health', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_TEXT_MODEL = 'listed/but-plain';
    process.env.OPENROUTER_FALLBACK_MODELS = 'listed/schema';
    const configured = getConfiguredOpenRouterModels();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: configured.map((id) => ({
            id,
            supported_parameters:
              id === 'listed/but-plain'
                ? ['response_format']
                : ['response_format', 'structured_outputs'],
          })),
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const health = await validateConfiguredModels();

    expect(health.status).toBe('degraded');
    expect(health.openrouter.structuredOutputUnsupportedModels).toEqual(['listed/but-plain']);
  });
});
