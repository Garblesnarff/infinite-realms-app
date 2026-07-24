const FALLBACK_PRICE_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.5 },
  'deepseek/deepseek-chat': { input: 0.2002, output: 0.8001 },
  'google/gemini-2.5-flash-image': { input: 0.3, output: 2.5 },
  'bytedance/seed-1.6-flash': { input: 0.075, output: 0.3 },
  'moonshotai/kimi-k2-0905': { input: 0.6, output: 2.5 },
};

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
