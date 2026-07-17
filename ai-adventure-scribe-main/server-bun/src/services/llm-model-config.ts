// Verified against https://openrouter.ai/api/v1/models on 2026-07-12.
// Structured DM responses require both response_format and structured_outputs.
export const DEFAULT_OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
export const DEFAULT_OPENROUTER_FALLBACK_MODELS = [
  'nex-agi/nex-n2-mini',
  'inclusionai/ling-2.6-1t',
];
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.5-flash-lite';
export const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite-preview';
export const DEFAULT_OPENROUTER_EXTRACTION_MODEL = 'google/gemini-3.1-flash-lite';
export const DEFAULT_OPENROUTER_EXTRACTION_FALLBACK_MODEL = 'nex-agi/nex-n2-mini';

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

export const getConfiguredOpenRouterModels = (): string[] =>
  dedupe([
    ...getOpenRouterModelCandidates(),
    process.env.OPENROUTER_EXTRACTION_MODEL || DEFAULT_OPENROUTER_EXTRACTION_MODEL,
    process.env.OPENROUTER_EXTRACTION_FALLBACK_MODEL ||
      DEFAULT_OPENROUTER_EXTRACTION_FALLBACK_MODEL,
  ]);

export const getGeminiModelCandidates = (preferred?: string): string[] => {
  const primary =
    preferred?.trim() || process.env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_GEMINI_TEXT_MODEL;
  const fallback = process.env.GEMINI_TEXT_FALLBACK?.trim() || DEFAULT_GEMINI_FALLBACK_MODEL;
  const variants = envList('GEMINI_MODEL_VARIANTS');
  const extras = /^gemini-2\.5-flash-lite$/i.test(primary)
    ? ['gemini-2.5-flash-lite-001', 'gemini-2.5-flash-lite-preview']
    : [];
  return dedupe([primary, ...variants, ...extras, fallback]);
};

export const getConfiguredGeminiModels = (): string[] => getGeminiModelCandidates();
