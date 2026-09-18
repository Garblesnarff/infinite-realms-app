import { afterEach, describe, expect, it } from 'vitest';

import { getCircuitBreaker, resetCircuitBreakersForTests } from '../../utils/circuit-breaker.js';
import { createUpstreamModelErrorBody, toUpstreamModelError } from '../llm-errors.js';
import { getConfiguredOpenRouterModels } from '../llm-model-config.js';
import { LLMProviderService } from '../llm-provider-service.js';
import {
  getModelHealthStatus,
  resetModelHealthForTests,
  validateConfiguredModels,
} from '../model-health.js';
import { getModelPricing, setFetchedModelPricing } from '../model-pricing.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetCircuitBreakersForTests();
  resetModelHealthForTests();
  setFetchedModelPricing([]);
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

  it('fails over memory extraction when the primary model is unavailable', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_EXTRACTION_MODEL = 'stale/extraction';
    process.env.OPENROUTER_EXTRACTION_FALLBACK_MODEL = 'fallback/extraction';
    const requestedModels: string[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      requestedModels.push(body.model);
      if (body.model === 'stale/extraction') return new Response('not found', { status: 404 });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"memories":[]}' } }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await LLMProviderService.extract({ prompt: 'extract memories' });

    expect(requestedModels).toEqual(['stale/extraction', 'fallback/extraction']);
    expect(result).toMatchObject({
      text: '{"memories":[]}',
      model: 'fallback/extraction',
      provider: 'openrouter',
    });
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
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ text: 'valid response' }) } }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({
      prompt: 'hello',
      responseSchema: { type: 'object', properties: { text: { type: 'string' } } },
    });

    expect(requests).toEqual([
      'broken/structured-model',
      'broken/structured-model',
      'fallback/structured-model',
    ]);
    expect(result).toMatchObject({
      text: JSON.stringify({ text: 'valid response' }),
      model: 'fallback/structured-model',
    });
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

  it('captures OpenRouter model pricing from the health listing in per-million units', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.GOOGLE_GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    const configured = getConfiguredOpenRouterModels();
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: configured.map((id) => ({
            id,
            supported_parameters: ['response_format', 'structured_outputs'],
            pricing: { prompt: '0.0000002', completion: '0.0000008' },
          })),
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await validateConfiguredModels();

    expect(getModelPricing(configured[0])?.input).toBeCloseTo(0.2);
    expect(getModelPricing(configured[0])?.output).toBeCloseTo(0.8);
  });
});
