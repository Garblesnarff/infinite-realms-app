/**
 * Per-million-token USD rates. `output` is the text completion rate. `imageOutput`
 * is the image-output rate for models that quote one; it is absent for text models.
 */
export type ModelPricing = { input: number; output: number; imageOutput?: number };

const FALLBACK_PRICE_PER_MILLION_USD: Record<string, ModelPricing> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.5 },
  'deepseek/deepseek-chat': { input: 0.2002, output: 0.8001 },
  'google/gemini-2.5-flash-image': { input: 0.3, output: 2.5 },
  // Verified 2026-09-22 against OpenRouter /api/v1/models: prompt $0.50/1M,
  // completion $3/1M, image_output $60/1M.
  'google/gemini-3.1-flash-image': { input: 0.5, output: 3, imageOutput: 60 },
  'bytedance/seed-1.6-flash': { input: 0.075, output: 0.3 },
  'moonshotai/kimi-k2-0905': { input: 0.6, output: 2.5 },
  // Google AI pricing, gemini-embedding-001, $0.15 / 1M input tokens. No output tokens.
  'gemini-embedding-001': { input: 0.15, output: 0 },
};

/**
 * OpenRouter quotes per-token rates. `completion` is the text rate and becomes
 * `output`. Image models also quote `image_output`, which becomes `imageOutput`.
 */
export function perMillionRatesFromOpenRouterPricing(
  pricing:
    | {
        prompt?: unknown;
        completion?: unknown;
        image_output?: unknown;
      }
    | null
    | undefined,
): ModelPricing | undefined {
  if (!pricing) return undefined;
  const inputPerToken = Number(pricing.prompt);
  const completionPerToken = Number(pricing.completion);
  const imageOutputPerToken = Number(pricing.image_output);
  if (
    !Number.isFinite(inputPerToken) ||
    inputPerToken < 0 ||
    !Number.isFinite(completionPerToken) ||
    completionPerToken < 0
  ) {
    return undefined;
  }
  const rates: ModelPricing = {
    input: inputPerToken * 1_000_000,
    output: completionPerToken * 1_000_000,
  };
  if (Number.isFinite(imageOutputPerToken) && imageOutputPerToken > 0) {
    rates.imageOutput = imageOutputPerToken * 1_000_000;
  }
  return rates;
}

const fetchedPricePerMillionUsd = new Map<string, ModelPricing>();

export function setFetchedModelPricing(
  pricing: Iterable<[string, ModelPricing]>,
): void {
  fetchedPricePerMillionUsd.clear();
  for (const [model, price] of pricing) {
    if (
      model &&
      Number.isFinite(price.input) &&
      price.input >= 0 &&
      Number.isFinite(price.output) &&
      price.output >= 0 &&
      (price.imageOutput === undefined ||
        (Number.isFinite(price.imageOutput) && price.imageOutput >= 0))
    ) {
      fetchedPricePerMillionUsd.set(model, price);
    }
  }
}

export function getModelPricing(model: string): ModelPricing | undefined {
  return fetchedPricePerMillionUsd.get(model) || FALLBACK_PRICE_PER_MILLION_USD[model];
}
