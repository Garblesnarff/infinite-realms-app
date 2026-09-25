import { getConfiguredGeminiModels, getConfiguredOpenRouterModels } from './llm-model-config.js';
import { perMillionRatesFromOpenRouterPricing, setFetchedModelPricing } from './model-pricing.js';
import { alert } from '../lib/alerting.js';
import { logger } from '../lib/logger.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=text';
const MODEL_HEALTH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MODEL_HEALTH_TIMEOUT_MS = 15_000;

export interface ProviderModelHealth {
  configured: boolean;
  checked: boolean;
  unlistedModels: string[];
  structuredOutputUnsupportedModels: string[];
  error?: string;
}

export interface ModelHealthStatus {
  status: 'healthy' | 'degraded';
  checkedAt: string | null;
  openrouter: ProviderModelHealth;
  gemini: ProviderModelHealth;
}

const initialProviderHealth = (): ProviderModelHealth => ({
  configured: false,
  checked: false,
  unlistedModels: [],
  structuredOutputUnsupportedModels: [],
});

let modelHealth: ModelHealthStatus = {
  status: 'healthy',
  checkedAt: null,
  openrouter: initialProviderHealth(),
  gemini: initialProviderHealth(),
};

type OpenRouterModel = {
  id?: unknown;
  supported_parameters?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown; image_output?: unknown };
};

const parseOpenRouterModels = (
  data: unknown,
): {
  parameters: Map<string, Set<string>>;
  pricing: Map<string, { input: number; output: number }>;
} => {
  const records = (data as { data?: OpenRouterModel[] })?.data;
  const models = (records || []).filter(
    (model): model is OpenRouterModel & { id: string } => typeof model.id === 'string',
  );
  const parameters = new Map(
    models.map((model) => [
      model.id,
      new Set(
        Array.isArray(model.supported_parameters)
          ? model.supported_parameters.filter(
              (parameter): parameter is string => typeof parameter === 'string',
            )
          : [],
      ),
    ]),
  );
  const pricing = new Map<string, { input: number; output: number }>();
  for (const model of models) {
    const rates = perMillionRatesFromOpenRouterPricing(model.pricing);
    if (rates) pricing.set(model.id, rates);
  }
  return { parameters, pricing };
};

const fetchOpenRouterModels = async (apiKey: string): Promise<Map<string, Set<string>>> => {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(MODEL_HEALTH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenRouter model list failed (${response.status})`);
  const parsed = parseOpenRouterModels(await response.json());
  setFetchedModelPricing(parsed.pricing);
  return parsed.parameters;
};

const parseGeminiModelIds = (data: unknown): Set<string> => {
  const records = (data as { models?: Array<{ name?: unknown }> })?.models;
  const ids = new Set<string>();
  for (const model of records || []) {
    if (typeof model.name !== 'string') continue;
    const id = model.name.replace(/^models\//, '');
    if (id) ids.add(id);
  }
  return ids;
};

const fetchGeminiModelIds = async (apiKey: string): Promise<Set<string>> => {
  const ids = new Set<string>();
  let successfulVersions = 0;
  let lastError: Error | undefined;

  for (const version of ['v1', 'v1beta']) {
    try {
      const url = new URL(`https://generativelanguage.googleapis.com/${version}/models`);
      url.searchParams.set('key', apiKey);
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(MODEL_HEALTH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Gemini ${version} model list failed (${response.status})`);
      for (const id of parseGeminiModelIds(await response.json())) ids.add(id);
      successfulVersions += 1;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (!successfulVersions) throw lastError || new Error('Gemini model list failed');
  return ids;
};

const alertProviderDegradation = (
  provider: 'openrouter' | 'gemini',
  unlistedModels: string[],
  structuredOutputUnsupportedModels: string[],
): void => {
  const reasons = [
    unlistedModels.length ? `unlisted=${unlistedModels.join(',')}` : null,
    structuredOutputUnsupportedModels.length
      ? `structured_output_unsupported=${structuredOutputUnsupportedModels.join(',')}`
      : null,
  ].filter((reason): reason is string => Boolean(reason));
  if (reasons.length) {
    alert('llm_model_health_degraded', { error: `${provider}: ${reasons.join('; ')}` });
  }
};

const checkProvider = async (
  provider: 'openrouter' | 'gemini',
  models: string[],
): Promise<ProviderModelHealth> => {
  const apiKey =
    provider === 'openrouter'
      ? process.env.OPENROUTER_API_KEY
      : process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return {
      configured: false,
      checked: false,
      unlistedModels: [],
      structuredOutputUnsupportedModels: [],
    };
  }

  try {
    if (provider === 'openrouter') {
      const available = await fetchOpenRouterModels(apiKey);
      const unlistedModels = models.filter((model) => !available.has(model));
      const structuredOutputUnsupportedModels = models.filter((model) => {
        const parameters = available.get(model);
        return (
          parameters !== undefined &&
          (!parameters.has('response_format') || !parameters.has('structured_outputs'))
        );
      });
      for (const model of unlistedModels) {
        logger.error({
          msg: `!!!!!!!!!!!!!!!! ${provider.toUpperCase()} MODEL NOT LISTED: ${model} !!!!!!!!!!!!!!!!`,
          alert: true,
          provider,
          model,
        });
      }
      for (const model of structuredOutputUnsupportedModels) {
        logger.error({
          msg: 'OPENROUTER MODEL LACKS STRUCTURED OUTPUT SUPPORT',
          alert: true,
          provider,
          model,
          requiredParameters: ['response_format', 'structured_outputs'],
        });
      }
      alertProviderDegradation(provider, unlistedModels, structuredOutputUnsupportedModels);
      return { configured: true, checked: true, unlistedModels, structuredOutputUnsupportedModels };
    }

    const available = await fetchGeminiModelIds(apiKey);
    const unlistedModels = models.filter((model) => !available.has(model));
    for (const model of unlistedModels) {
      logger.error({
        msg: `!!!!!!!!!!!!!!!! ${provider.toUpperCase()} MODEL NOT LISTED: ${model} !!!!!!!!!!!!!!!!`,
        alert: true,
        provider,
        model,
      });
    }
    alertProviderDegradation(provider, unlistedModels, []);
    return {
      configured: true,
      checked: true,
      unlistedModels,
      structuredOutputUnsupportedModels: [],
    };
  } catch (error) {
    logger.error({ msg: 'LLM_MODEL_HEALTH_CHECK_FAILED', provider, error });
    alert('llm_model_health_check_failed', {
      error: `${provider}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return {
      configured: true,
      checked: true,
      unlistedModels: [],
      structuredOutputUnsupportedModels: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const validateConfiguredModels = async (): Promise<ModelHealthStatus> => {
  const [openrouter, gemini] = await Promise.all([
    checkProvider('openrouter', getConfiguredOpenRouterModels()),
    checkProvider('gemini', getConfiguredGeminiModels()),
  ]);
  modelHealth = {
    status:
      openrouter.unlistedModels.length ||
      openrouter.structuredOutputUnsupportedModels.length ||
      gemini.unlistedModels.length ||
      openrouter.error ||
      gemini.error
        ? 'degraded'
        : 'healthy',
    checkedAt: new Date().toISOString(),
    openrouter,
    gemini,
  };
  return modelHealth;
};

export const getModelHealthStatus = (): ModelHealthStatus => modelHealth;

export const getStructuredOutputUnsupportedModels = (): string[] =>
  modelHealth.openrouter.structuredOutputUnsupportedModels;

export const startModelHealthChecks = (): ReturnType<typeof setInterval> => {
  const interval = setInterval(() => void validateConfiguredModels(), MODEL_HEALTH_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
};

export const resetModelHealthForTests = (): void => {
  modelHealth = {
    status: 'healthy',
    checkedAt: null,
    openrouter: initialProviderHealth(),
    gemini: initialProviderHealth(),
  };
};
