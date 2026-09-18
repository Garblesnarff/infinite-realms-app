import { afterEach, describe, expect, it } from 'vitest';

import {
  getConfiguredGeminiModels,
  getConfiguredOpenRouterModels,
  getOpenRouterExtractionModelCandidates,
} from '../llm-model-config.js';
import { resetModelHealthForTests, validateConfiguredModels } from '../model-health.js';
import geminiModelListing from './fixtures/gemini-model-list.json';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetModelHealthForTests();
});

describe('Gemini model defaults', () => {
  it('are all present in the recorded Generative Language v1/v1beta model listing', async () => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    delete process.env.OPENROUTER_API_KEY;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(geminiModelListing), { status: 200 })) as unknown as typeof fetch;

    const health = await validateConfiguredModels();

    expect(getConfiguredGeminiModels()).toEqual([
      'gemini-2.5-flash-lite',
      'gemini-3.1-flash-lite-preview',
    ]);
    expect(health.gemini.unlistedModels).toEqual([]);
    expect(getConfiguredGeminiModels()).not.toContain('gemini-2.5-flash-lite-001');
    expect(getConfiguredGeminiModels()).not.toContain('gemini-2.5-flash-lite-preview');
  });
});

describe('OpenRouter extraction model defaults', () => {
  it('uses the live-verified primary and fallback instead of retired IDs', () => {
    delete process.env.OPENROUTER_EXTRACTION_MODEL;
    delete process.env.OPENROUTER_EXTRACTION_FALLBACK_MODEL;
    delete process.env.OPENROUTER_TEXT_MODEL;
    delete process.env.OPENROUTER_FALLBACK_MODELS;

    expect(getOpenRouterExtractionModelCandidates()).toEqual([
      'mistralai/mistral-nemo',
      'meta-llama/llama-3.1-8b-instruct',
    ]);
    expect(getConfiguredOpenRouterModels()).not.toEqual(
      expect.arrayContaining([
        'inclusionai/ling-2.6-flash',
        'inclusionai/ling-2.6-1t',
        'nex-agi/nex-n2-mini',
      ]),
    );
  });
});
