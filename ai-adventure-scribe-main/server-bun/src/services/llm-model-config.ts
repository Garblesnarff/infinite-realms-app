// OpenRouter defaults were verified against https://openrouter.ai/api/v1/models on 2026-09-13.
// Gemini defaults are covered by the recorded Generative Language model-list fixture in
// llm-model-config.test.ts. Keep these ids in the same form returned by /v1/models.
// Structured DM responses require both response_format and structured_outputs.
export const DEFAULT_OPENROUTER_TEXT_MODEL = 'google/gemini-3.1-flash-lite';
const DEFAULT_OPENROUTER_FALLBACK_MODELS = [
  'mistralai/mistral-nemo',
  'meta-llama/llama-3.1-8b-instruct',
];
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite-preview';
const DEFAULT_OPENROUTER_EXTRACTION_MODEL = 'mistralai/mistral-nemo';
const DEFAULT_OPENROUTER_EXTRACTION_FALLBACK_MODEL = 'meta-llama/llama-3.1-8b-instruct';

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

/**
 * #633: Anthropic models reject OpenRouter's strict `json_schema` response_format
 * (HTTP 400). Those candidates get the schema as system-prompt instructions instead.
 * Now backed by the #782 item 4 capability table below.
 */
export const modelSupportsStrictSchema = (model: string): boolean =>
  getVendorCapabilityProfile(model).strictJsonSchema;

/**
 * #782 item 4: per-vendor capability profile for DM schema delivery.
 * Keyed by vendor prefix — the part of an OpenRouter model id before the
 * first `/` (e.g. `google/`, `anthropic/`).
 */
export interface VendorCapabilityProfile {
  /**
   * The vendor accepts OpenRouter's strict `json_schema` response_format.
   * False means the schema rides as system-prompt instructions and the
   * reply is enforced locally with ajv instead.
   */
  strictJsonSchema: boolean;
  /**
   * #782 schema budgets. Targets from the epic (docs checked 2026-10-16/17,
   * ratcheted by dm-response-schema-budget.test.ts): at most 16 unions and
   * 24 optionals, no `oneOf`, no numeric/length keywords. Not consumed by the
   * delivery path yet — items 5-8 wire enforcement as the schema shrinks.
   */
  maxUnions: number;
  maxOptional: number;
  allowsOneOf: boolean;
  allowsNumericConstraints: boolean;
  /** No vendor requires this today; the live schema carries 20 optionals. */
  requiresAllProperties: boolean;
  /** OpenRouter `stream: true` token deltas. Used for every candidate today. */
  streaming: boolean;
  /** The `cache_control` prompt-cache breakpoint. Set for every candidate today. */
  promptCache: boolean;
  /**
   * The vendor accepts a `temperature` field on OpenRouter. False means the
   * field is omitted from the request body: OpenRouter has no anthropic/
   * endpoint that accepts `temperature` together with `require_parameters`,
   * so sending both returns 404 (#783).
   */
  supportsTemperature: boolean;
}

/** #782 target budgets, shared by every vendor until items 5-8 tighten them. */
const EPIC_SCHEMA_BUDGET = {
  maxUnions: 16,
  maxOptional: 24,
  allowsOneOf: false,
  allowsNumericConstraints: false,
} as const;

const DEFAULT_VENDOR_CAPABILITIES: Record<string, VendorCapabilityProfile> = {
  'google/': {
    strictJsonSchema: true,
    ...EPIC_SCHEMA_BUDGET,
    requiresAllProperties: false,
    streaming: true,
    promptCache: true,
    supportsTemperature: true,
  },
  'anthropic/': {
    strictJsonSchema: false,
    ...EPIC_SCHEMA_BUDGET,
    requiresAllProperties: false,
    streaming: true,
    promptCache: true,
    supportsTemperature: false,
  },
  'openai/': {
    strictJsonSchema: true,
    ...EPIC_SCHEMA_BUDGET,
    requiresAllProperties: false,
    streaming: true,
    promptCache: true,
    supportsTemperature: true,
  },
  'mistralai/': {
    strictJsonSchema: true,
    ...EPIC_SCHEMA_BUDGET,
    requiresAllProperties: false,
    streaming: true,
    promptCache: true,
    supportsTemperature: true,
  },
  'meta-llama/': {
    strictJsonSchema: true,
    ...EPIC_SCHEMA_BUDGET,
    requiresAllProperties: false,
    streaming: true,
    promptCache: true,
    supportsTemperature: true,
  },
};

/**
 * Conservative fallback for unknown vendors (or a bare model id with no
 * vendor prefix): schema as instructions + ajv, never strict structured
 * output.
 */
const CONSERVATIVE_CAPABILITIES: VendorCapabilityProfile = {
  strictJsonSchema: false,
  ...EPIC_SCHEMA_BUDGET,
  requiresAllProperties: false,
  streaming: true,
  promptCache: true,
  supportsTemperature: true,
};

const CAPABILITY_FIELDS: (keyof VendorCapabilityProfile)[] = [
  'strictJsonSchema',
  'maxUnions',
  'maxOptional',
  'allowsOneOf',
  'allowsNumericConstraints',
  'requiresAllProperties',
  'streaming',
  'promptCache',
  'supportsTemperature',
];

/** Keep only known fields with the right value types; drop everything else. */
const sanitizeCapabilityOverride = (value: unknown): Partial<VendorCapabilityProfile> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Partial<VendorCapabilityProfile> = {};
  const record = value as Record<string, unknown>;
  for (const field of CAPABILITY_FIELDS) {
    const v = record[field];
    if (typeof v === typeof CONSERVATIVE_CAPABILITIES[field]) {
      (out as Record<string, unknown>)[field] = v;
    }
  }
  return out;
};

/**
 * Env-overridable capability table. `LLM_VENDOR_CAPABILITIES` holds a JSON
 * object mapping vendor prefix to a partial profile, merged over the
 * defaults — e.g. `{"anthropic/": {"strictJsonSchema": true}}`. Keys must
 * carry the trailing slash to match the lookup. Malformed
 * JSON, unknown fields, and wrong-typed values are ignored. Parsed per call
 * so tests can set and unset it freely.
 */
const readCapabilityOverrides = (): Record<string, Partial<VendorCapabilityProfile>> => {
  const raw = (process.env.LLM_VENDOR_CAPABILITIES || '').trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, Partial<VendorCapabilityProfile>> = {};
  for (const [prefix, profile] of Object.entries(parsed as Record<string, unknown>)) {
    out[prefix] = sanitizeCapabilityOverride(profile);
  }
  return out;
};

/**
 * #782 item 4: capability profile for a model id. Unknown vendor prefixes
 * (and bare ids with no `/`) get the conservative fallback. Env overrides
 * can also introduce entirely new vendor prefixes.
 */
export const getVendorCapabilityProfile = (model: string): VendorCapabilityProfile => {
  const trimmed = model.trim();
  // OpenRouter `~vendor/` aliases pin to a vendor's own endpoint (e.g.
  // `~google/gemini-3.1-flash-lite`). Strip the leading `~` before the
  // capability-table and env-override lookups so the alias resolves through
  // the vendor's profile instead of silently falling back to conservative
  // (which would drop the strict schema on e.g. `~google/`).
  const normalized = trimmed.startsWith('~') ? trimmed.slice(1) : trimmed;
  const slash = normalized.indexOf('/');
  const prefix = slash > 0 ? normalized.slice(0, slash + 1) : '';
  const base = (prefix && DEFAULT_VENDOR_CAPABILITIES[prefix]) || CONSERVATIVE_CAPABILITIES;
  const override = prefix ? readCapabilityOverrides()[prefix] : undefined;
  return { ...base, ...override };
};
