/**
 * Dollar rows written by recordProviderUsage (#2160).
 * Image output uses the per-million image rate. Voice passes an explicit
 * character cost because the token table cannot express $0.05 / 1K chars.
 */
import { describe, expect, it, mock } from 'bun:test';

const inserts: unknown[][] = [];
let failWrites = false;

const sql = Object.assign(
  async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    if (failWrites && values.length > 0) {
      throw new Error('ai_usage insert failed');
    }
    if (values.length > 0) inserts.push(values);
    return [{ cost_usd: 0 }];
  },
  {
    begin: async () => {
      throw new Error('quota path is not under test');
    },
  },
);

mock.module('../../lib/db.js', () => ({ sql }));
mock.module('../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { AIUsageService, elevenLabsCharacterCostUsd } = await import('../ai-usage-service.js');
const { getModelPricing, perMillionRatesFromOpenRouterPricing } =
  await import('../model-pricing.js');

describe('image and voice dollar costs', () => {
  it('prices google/gemini-3.1-flash-image at $0.50 in, $3 text out and $60 image-output', () => {
    expect(getModelPricing('google/gemini-3.1-flash-image')).toEqual({
      input: 0.5,
      output: 3,
      imageOutput: 60,
    });
    expect(
      perMillionRatesFromOpenRouterPricing({
        prompt: '0.0000005',
        completion: '0.000003',
        image_output: '0.00006',
      }),
    ).toEqual({ input: 0.5, output: 3, imageOutput: 60 });
    const textOnly = perMillionRatesFromOpenRouterPricing({
      prompt: '0.0000002',
      completion: '0.0000008',
    });
    expect(textOnly?.input).toBeCloseTo(0.2);
    expect(textOnly?.output).toBeCloseTo(0.8);
    expect(textOnly?.imageOutput).toBeUndefined();
  });

  it('writes image cost from prompt and completion tokens', async () => {
    inserts.length = 0;
    await AIUsageService.recordProviderUsage({
      userId: 'image-cost-user',
      plan: 'pro',
      type: 'image',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-image',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    const row = inserts.find((values) => values.includes('google/gemini-3.1-flash-image'));
    expect(row).toBeTruthy();
    expect(row).toContain(1_000_000);
    expect(row).toContain(60.5);
  });

  it('prices text completion and image tokens apart when the provider reports both (#2182)', async () => {
    inserts.length = 0;
    await AIUsageService.recordProviderUsage({
      userId: 'mixed-cost-user',
      plan: 'pro',
      type: 'image',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-image',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      imageOutputTokens: 400_000,
    });

    const row = inserts.find((values) => values.includes('mixed-cost-user'));
    // 1M in * $0.50 + 600K text * $3 + 400K image * $60, per million.
    expect(row).toContain(0.5 + 1.8 + 24);
    expect(row?.at(-2)).toBe(400_000);
  });

  it('prices image-model text output at the text rate when no image tokens are reported', async () => {
    inserts.length = 0;
    await AIUsageService.recordProviderUsage({
      userId: 'text-on-image-model-user',
      plan: 'pro',
      type: 'llm',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-image',
      inputTokens: 0,
      outputTokens: 1_000_000,
    });

    const row = inserts.find((values) => values.includes('text-on-image-model-user'));
    expect(row).toContain(3);
    expect(row?.at(-2)).toBeNull();
  });

  it('prices an image call with no breakdown wholly at the image rate and stores NULL', async () => {
    inserts.length = 0;
    await AIUsageService.recordProviderUsage({
      userId: 'no-breakdown-user',
      plan: 'pro',
      type: 'image',
      provider: 'openrouter',
      model: 'google/gemini-3.1-flash-image',
      inputTokens: 0,
      outputTokens: 1_000_000,
    });

    const row = inserts.find((values) => values.includes('no-breakdown-user'));
    expect(row).toContain(60);
    expect(row?.at(-2)).toBeNull();
  });

  it('clamps reported image tokens to the output total and falls back to the text rate', async () => {
    inserts.length = 0;
    await AIUsageService.recordProviderUsage({
      userId: 'clamp-user',
      plan: 'pro',
      type: 'image',
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-image',
      inputTokens: 0,
      outputTokens: 1_000_000,
      imageOutputTokens: 5_000_000,
    });

    const row = inserts.find((values) => values.includes('clamp-user'));
    // google/gemini-2.5-flash-image has no image-output rate: $2.50 text rate applies.
    expect(row).toContain(2.5);
    expect(row?.at(-2)).toBe(1_000_000);
  });

  it('stores voice characters in input_tokens and the character price in cost_usd', async () => {
    inserts.length = 0;
    const characters = 2500;
    await AIUsageService.recordProviderUsage({
      userId: 'voice-cost-user',
      plan: 'pro',
      type: 'voice',
      provider: 'elevenlabs',
      model: 'eleven_turbo_v2_5',
      inputTokens: characters,
      outputTokens: 0,
      costUsd: elevenLabsCharacterCostUsd(characters),
    });

    const row = inserts.find((values) => values.includes('elevenlabs'));
    expect(row).toEqual(
      expect.arrayContaining([
        'elevenlabs',
        'eleven_turbo_v2_5',
        characters,
        0,
        elevenLabsCharacterCostUsd(characters),
      ]),
    );
    expect(elevenLabsCharacterCostUsd(characters)).toBe((characters * 0.05) / 1000);
  });

  it('writes session_id on the same row as cost_usd', async () => {
    inserts.length = 0;
    await AIUsageService.recordProviderUsage({
      userId: 'session-cost-user',
      plan: 'pro',
      type: 'llm',
      provider: 'openrouter',
      model: 'deepseek/deepseek-chat',
      inputTokens: 10,
      outputTokens: 20,
      costUsd: 1.25,
      sessionId: 'session-2160',
    });

    const row = inserts.find((values) => values.includes('session-2160'));
    expect(row).toEqual(expect.arrayContaining(['session-2160', 1.25]));
  });

  it('resolves when the usage insert fails', async () => {
    failWrites = true;
    await expect(
      AIUsageService.recordProviderUsage({
        userId: 'failed-cost-user',
        plan: 'free',
        type: 'image',
        provider: 'openrouter',
        model: 'google/gemini-3.1-flash-image',
        inputTokens: 1,
        outputTokens: 1,
        sessionId: 'session-fail',
      }),
    ).resolves.toBeUndefined();
    failWrites = false;
  });
});
