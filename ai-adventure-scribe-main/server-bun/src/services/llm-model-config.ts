// OpenRouter defaults were verified against https://openrouter.ai/api/v1/models on 2026-09-13.
// Gemini defaults are covered by the recorded Generative Language model-list fixture in
// llm-model-config.test.ts. Keep these ids in the same form returned by /v1/models.
// Structured DM responses require both response_format and structured_outputs.
export const DEFAULT_OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
export const DEFAULT_OPENROUTER_FALLBACK_MODELS = [
  'mistralai/mistral-nemo',
  'meta-llama/llama-3.1-8b-instruct',
];
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.5-flash-lite';
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite-preview';
export const DEFAULT_OPENROUTER_EXTRACTION_MODEL = 'mistralai/mistral-nemo';
export const DEFAULT_OPENROUTER_EXTRACTION_FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct';

const dedupe = (values: string[]): string[] => {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !seen.has(value) && seen.add(value));
};

const envList = (name: string): string[] =>
  (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export const getOpenRouterModelCandidates = (preferred?: string): string[] => {
  const primary =
    preferred?.trim() || process.env.OPENROUTER_TEXT_MODEL?.trim() || DEFAULT_OPENROUTER_TEXT_MODEL;
  const fallbackModels = envList('OPENROUTER_FALLBACK_MODELS');
  return dedupe([
    primary,
    ...(fallbackModels.length ? fallbackModels : DEFAULT_OPENROUTER_FALLBACK_MODELS),
  ]);
};

export const getOpenRouterExtractionModelCandidates = (): string[] =>
  dedupe([
    process.env.OPENROUTER_EXTRACTION_MODEL?.trim() || DEFAULT_OPENROUTER_EXTRACTION_MODEL,
    process.env.OPENROUTER_EXTRACTION_FALLBACK_MODEL?.trim() ||
      DEFAULT_OPENROUTER_EXTRACTION_FALLBACK_MODEL,
  ]);

export const getConfiguredOpenRouterModels = (): string[] =>
  dedupe([...getOpenRouterModelCandidates(), ...getOpenRouterExtractionModelCandidates()]);

export const getGeminiModelCandidates = (preferred?: string): string[] => {
  const primary =
    preferred?.trim() || process.env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL;
  const fallback = process.env.GEMINI_TEXT_FALLBACK?.trim() || DEFAULT_GEMINI_FALLBACK_MODEL;
  const variants = envList('GEMINI_MODEL_VARIANTS');
  return dedupe([primary, ...variants, fallback]);
};

export const getConfiguredGeminiModels = (): string[] => getGeminiModelCandidates();
