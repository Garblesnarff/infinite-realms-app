const FALLBACK_PRICE_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.5 },
  'deepseek/deepseek-chat': { input: 0.2002, output: 0.8001 },
  'google/gemini-2.5-flash-image': { input: 0.3, output: 2.5 },
  // Verified 2026-09-22 against OpenRouter /api/v1/models: prompt $0.50/1M,
  // image_output $60/1M. Text completion on this model is $3/1M and is not
  // the image rate. `output` is the image-output rate.
  'google/gemini-3.1-flash-image': { input: 0.5, output: 60 },
  'bytedance/seed-1.6-flash': { input: 0.075, output: 0.3 },
  'moonshotai/kimi-k2-0905': { input: 0.6, output: 2.5 },
  // Google AI pricing, gemini-embedding-001, $0.15 / 1M input tokens. No output tokens.
  'gemini-embedding-001': { input: 0.15, output: 0 },
};

/**
 * OpenRouter quotes per-token rates. Image models also quote `image_output`,
 * which is the rate that has to be stored as `output` — `completion` is the
 * text rate and is an order of magnitude cheaper.
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
): { input: number; output: number } | undefined {
  if (!pricing) return undefined;
  const inputPerToken = Number(pricing.prompt);
  const completionPerToken = Number(pricing.completion);
  const imageOutputPerToken = Number(pricing.image_output);
  const outputPerToken =
    Number.isFinite(imageOutputPerToken) && imageOutputPerToken > 0
      ? imageOutputPerToken
      : completionPerToken;
  if (
    !Number.isFinite(inputPerToken) ||
    inputPerToken < 0 ||
    !Number.isFinite(outputPerToken) ||
    outputPerToken < 0
  ) {
    return undefined;
  }
  return {
    input: inputPerToken * 1_000_000,
    output: outputPerToken * 1_000_000,
  };
}

const fetchedPricePerMillionUsd = new Map<string, { input: number; output: number }>();

export function setFetchedModelPricing(
  pricing: Iterable<[string, { input: number; output: number }]>,
): void {
  fetchedPricePerMillionUsd.clear();
  for (const [model, price] of pricing) {
    if (
      model &&
      Number.isFinite(price.input) &&
      price.input >= 0 &&
      Number.isFinite(price.output) &&
      price.output >= 0
    ) {
      fetchedPricePerMillionUsd.set(model, price);
    }
  }
}

export function getModelPricing(model: string): { input: number; output: number } | undefined {
  return fetchedPricePerMillionUsd.get(model) || FALLBACK_PRICE_PER_MILLION_USD[model];
}
