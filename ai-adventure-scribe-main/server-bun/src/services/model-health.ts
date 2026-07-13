import { logger } from '../lib/logger.js';
import { getConfiguredGeminiModels, getConfiguredOpenRouterModels } from './llm-model-config.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=text';
const MODEL_HEALTH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MODEL_HEALTH_TIMEOUT_MS = 15_000;

export interface ProviderModelHealth {
  configured: boolean;
  checked: boolean;
  unlistedModels: string[];
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
});

let modelHealth: ModelHealthStatus = {
  status: 'healthy',
  checkedAt: null,
  openrouter: initialProviderHealth(),
  gemini: initialProviderHealth(),
};

const parseModelIds = (data: unknown): Set<string> => {
  const records = (data as { data?: Array<{ id?: unknown }> })?.data;
  return new Set(
    (records || []).map((model) => model.id).filter((id): id is string => typeof id === 'string'),
  );
};

const fetchOpenRouterModelIds = async (apiKey: string): Promise<Set<string>> => {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(MODEL_HEALTH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenRouter model list failed (${response.status})`);
  return parseModelIds(await response.json());
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

const checkProvider = async (
  provider: 'openrouter' | 'gemini',
  models: string[],
): Promise<ProviderModelHealth> => {
  const apiKey =
    provider === 'openrouter'
      ? process.env.OPENROUTER_API_KEY
      : process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) return { configured: false, checked: false, unlistedModels: [] };

  try {
    const available =
      provider === 'openrouter'
        ? await fetchOpenRouterModelIds(apiKey)
        : await fetchGeminiModelIds(apiKey);
    const unlistedModels = models.filter((model) => !available.has(model));
    for (const model of unlistedModels) {
      logger.error({
        msg: `!!!!!!!!!!!!!!!! ${provider.toUpperCase()} MODEL NOT LISTED: ${model} !!!!!!!!!!!!!!!!`,
        alert: true,
        provider,
        model,
      });
    }
    return { configured: true, checked: true, unlistedModels };
  } catch (error) {
    logger.error({ msg: 'LLM_MODEL_HEALTH_CHECK_FAILED', provider, error });
    return {
      configured: true,
      checked: true,
      unlistedModels: [],
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

export const startModelHealthChecks = (): ReturnType<typeof setInterval> => {
  void validateConfiguredModels();
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
