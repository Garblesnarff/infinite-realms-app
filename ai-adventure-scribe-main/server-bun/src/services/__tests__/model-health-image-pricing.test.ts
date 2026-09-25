/**
 * Model-health must keep image_output as the output rate (#2160).
 * The text-modality listing includes image models, and `completion` on those
 * models is the cheap text rate, not the image rate.
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { getConfiguredOpenRouterModels } from '../llm-model-config.js';
import { resetModelHealthForTests, validateConfiguredModels } from '../model-health.js';
import { getModelPricing, setFetchedModelPricing } from '../model-pricing.js';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetModelHealthForTests();
  setFetchedModelPricing([]);
});

describe('OpenRouter image output pricing', () => {
  it('stores image_output, not text completion, as the output rate', async () => {
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
            pricing: { prompt: '0.0000005', completion: '0.000003', image_output: '0.00006' },
          })),
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await validateConfiguredModels();

    expect(getModelPricing(configured[0])?.input).toBeCloseTo(0.5);
    expect(getModelPricing(configured[0])?.output).toBeCloseTo(60);
  });
});
