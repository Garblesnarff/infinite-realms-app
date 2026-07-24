import { afterEach, describe, expect, it } from 'vitest';

import geminiModelListing from './fixtures/gemini-model-list.json';
import { getConfiguredGeminiModels } from '../llm-model-config.js';
import { resetModelHealthForTests, validateConfiguredModels } from '../model-health.js';

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
    globalThis.fetch = (async () => new Response(JSON.stringify(geminiModelListing), { status: 200 })) as unknown as typeof fetch;

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
