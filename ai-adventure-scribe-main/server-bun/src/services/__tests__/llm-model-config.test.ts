import { afterEach, describe, expect, it } from 'vitest';

import {
  getConfiguredGeminiModels,
  getConfiguredOpenRouterModels,
  getOpenRouterExtractionModelCandidates,
  getVendorCapabilityProfile,
  modelSupportsStrictSchema,
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

/**
 * #781 item 1: the vendor segment is matched after a single `~` prefix. Model ids
 * follow the OpenRouter /v1/models form (`vendor/slug`); the `~vendor/`
 * alias form pins to the vendor's own endpoint. The `~` strip in
 * getVendorCapabilityProfile was already on main; these tests pin it per
 * form — the tilde cases below fail if the strip is removed, because the
 * unknown-prefix fallback is conservative (never strict), so a stripped
 * vendor would silently lose the strict schema (google/openai/mistralai/
 * meta-llama) or resolve to the wrong delivery (anthropic: 'instructed'
 * instead of 'tool').
 */
describe('Vendor capability alias matching (#781)', () => {
  it('matches a plain anthropic/ id to the tool delivery, not strict', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('anthropic/claude-opus-4-1')).toBe(false);
    expect(getVendorCapabilityProfile('anthropic/claude-opus-4-1').schemaDelivery).toBe('tool');
  });

  it('matches a ~anthropic/ alias to the tool delivery, not strict', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('~anthropic/claude-opus-4-1')).toBe(false);
    expect(getVendorCapabilityProfile('~anthropic/claude-opus-4-1').schemaDelivery).toBe('tool');
  });

  it('matches a plain google/ id to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('google/gemini-3.1-flash-lite')).toBe(true);
    expect(getVendorCapabilityProfile('google/gemini-3.1-flash-lite').schemaDelivery).toBe(
      'strict',
    );
  });

  it('matches a ~google/ alias to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('~google/gemini-3.1-flash-lite')).toBe(true);
    expect(getVendorCapabilityProfile('~google/gemini-3.1-flash-lite').schemaDelivery).toBe(
      'strict',
    );
  });

  it('matches a plain openai/ id to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('openai/gpt-5')).toBe(true);
    expect(getVendorCapabilityProfile('openai/gpt-5').schemaDelivery).toBe('strict');
  });

  it('matches a ~openai/ alias to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('~openai/gpt-5')).toBe(true);
    expect(getVendorCapabilityProfile('~openai/gpt-5').schemaDelivery).toBe('strict');
  });

  it('matches a plain mistralai/ id to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('mistralai/mistral-nemo')).toBe(true);
    expect(getVendorCapabilityProfile('mistralai/mistral-nemo').schemaDelivery).toBe('strict');
  });

  it('matches a ~mistralai/ alias to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('~mistralai/mistral-nemo')).toBe(true);
    expect(getVendorCapabilityProfile('~mistralai/mistral-nemo').schemaDelivery).toBe('strict');
  });

  it('matches a plain meta-llama/ id to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('meta-llama/llama-3.1-8b-instruct')).toBe(true);
    expect(getVendorCapabilityProfile('meta-llama/llama-3.1-8b-instruct').schemaDelivery).toBe(
      'strict',
    );
  });

  it('matches a ~meta-llama/ alias to the strict delivery', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('~meta-llama/llama-3.1-8b-instruct')).toBe(true);
    expect(getVendorCapabilityProfile('~meta-llama/llama-3.1-8b-instruct').schemaDelivery).toBe(
      'strict',
    );
  });

  it('falls back to instructed for a bare id with no vendor prefix', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('claude-opus-4-1')).toBe(false);
    expect(getVendorCapabilityProfile('claude-opus-4-1').schemaDelivery).toBe('instructed');
  });

  it('falls back to instructed for an unknown vendor prefix', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('unknown-vendor/some-model')).toBe(false);
    expect(getVendorCapabilityProfile('unknown-vendor/some-model').schemaDelivery).toBe(
      'instructed',
    );
  });

  it('trims surrounding whitespace before matching a ~anthropic/ alias', () => {
    delete process.env.LLM_VENDOR_CAPABILITIES;
    expect(modelSupportsStrictSchema('  ~anthropic/claude-opus-4-1  ')).toBe(false);
    expect(getVendorCapabilityProfile('  ~anthropic/claude-opus-4-1  ').schemaDelivery).toBe(
      'tool',
    );
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
