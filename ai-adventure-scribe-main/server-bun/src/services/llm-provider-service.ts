import Ajv, { type ValidateFunction } from 'ajv';

import { isRetryableUpstreamStatus, LLMUpstreamError } from './llm-errors.js';
import { llmFetch } from './llm-fixture-fetch.js';
import { alertProviderKeyLimit, isProviderKeyLimitError } from './llm-key-limit.js';
import {
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_OPENROUTER_TEXT_MODEL,
  getGeminiModelCandidates,
  getOpenRouterExtractionModelCandidates,
  getOpenRouterModelCandidates,
  getVendorCapabilityProfile,
} from './llm-model-config.js';
import { getStructuredOutputUnsupportedModels } from './model-health.js';
import { logger } from '../lib/logger.js';
import { getCircuitBreaker, CircuitOpenError } from '../utils/circuit-breaker.js';

/**
 * Extracted from routes/v1/llm.ts
 * Handles LLM generation logic for multiple providers (OpenRouter, Gemini)
 */

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

/**
 * #633 PR3: an explicit text content block for the OpenRouter chat-completions
 * wire. Only the stable system message uses this shape, so it can carry the
 * Anthropic `cache_control` breakpoint: OpenRouter forwards the marker verbatim
 * to Anthropic and translates it for Google/OpenAI-routed models (OpenRouter
 * prompt-caching docs), so it is safe on every candidate model. Anthropic
 * allows at most 4 breakpoints per request; this file sets exactly one.
 */
export type OpenRouterTextBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

/** An OpenRouter chat message: plain string content, or explicit text blocks. */
export type OpenRouterChatMessage = {
  role: ChatMessage['role'];
  content: string | OpenRouterTextBlock[];
};

export interface LLMGenerateOptions {
  prompt: string;
  /**
   * #352: stable system block, sent as the `system` message so the provider
   * can cache on the prompt prefix.
   */
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  history?: ChatMessage[];
  provider?: 'openrouter' | 'gemini';
  responseSchema?: Record<string, unknown>;
  /**
   * #633 PR2: when set, the OpenRouter call uses `stream: true` and this
   * callback fires once per content delta as tokens arrive. The full text is
   * still accumulated and returned in `LLMResponse.text`, so validation,
   * retry and every downstream step behave exactly as non-streaming.
   */
  onToken?: (deltaText: string) => void;
  /**
   * #633: fires before every provider attempt (each retry and each failover
   * candidate). Streamed deltas from a rejected attempt are discarded by the
   * caller, so it can reset its preview here.
   */
  onAttemptStart?: () => void;
}

export interface LLMExtractOptions {
  prompt: string;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  model?: string;
  provider?: 'openrouter' | 'gemini';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    /**
     * #352: prompt tokens served from the provider's prompt cache this turn
     * (OpenRouter `usage.prompt_tokens_details.cached_tokens`, Gemini
     * `usageMetadata.cachedContentTokenCount`). Zero/absent means no cache
     * hit. Only present when the request asked for usage details.
     */
    cachedInputTokens?: number;
    /** #352: prompt tokens written to the cache on this turn. */
    cacheWriteTokens?: number;
    /**
     * #782 item 4: which schema-delivery path the winning candidate used —
     * strict structured output, or schema-as-instructions with ajv
     * enforcement. Only set when `responseSchema` was requested; absent on
     * schema-less turns.
     */
    schemaDelivery?: 'strict-json-schema' | 'schema-as-instructions';
    /** LLM_STRICT_BRANCH_VALIDATION=shadow: accepted replies that failed the full schema. Absent when zero. */
    schemaShadowInvalid?: number;
  };
  error?: string;
  status?: number;
  details?: string;
  attempts?: string[];
  retryAfter?: number;
  upstreamStatus?: number;
  retryable?: boolean;
  /**
   * #350: the key-limit verdict, computed once per chain-exhausted event from
   * the raw upstream status + body (OR'd across every model attempt) and
   * carried on the result. The alert and the route both honor this single
   * verdict, so they can never disagree about what happened.
   */
  providerKeyLimit?: boolean;
}

/**
 * #750 step 2: provider finish reasons that mean the model stopped because it
 * hit the output token ceiling, not because it chose to: OpenRouter `length`,
 * Anthropic `max_tokens`, Gemini `MAX_TOKENS`. The comparison is
 * case-insensitive.
 */
export const isTruncatedFinishReason = (reason: string | null | undefined): boolean => {
  if (typeof reason !== 'string') return false;
  const normalized = reason.trim().toLowerCase();
  return normalized === 'length' || normalized === 'max_tokens';
};

const GEMINI_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
export const TEXT_PROVIDER_TIMEOUT_MS = 60_000;
/** #633: instruction line sent ahead of the schema for models without strict json_schema. */
const SCHEMA_INSTRUCTION_LINE =
  'Reply with exactly one JSON object that matches this JSON Schema. No prose, no code fences.';
// #783: reminder on the last user message of the non-strict branch.
const JSON_REMINDER_LINE =
  'Reply with the JSON object only. The first character of your reply must be {.';
let geminiModelCache: { ids: Set<string>; fetchedAt: number } | null = null;

const failoverReason = (status?: number): string =>
  status ? `upstream_status_${status}` : 'provider_error';

const logFailover = (from: string, to: string, status?: number): void => {
  logger.warn({
    msg: 'LLM_FAILOVER',
    from,
    to,
    reason: failoverReason(status),
  });
};

const retryAfterSeconds = (response: Response): number | undefined => {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
};

// #350 B1: the circuit breaker opens after 3 consecutive failures, so during
// a key-limit outage most degraded turns fail fast with CircuitOpenError and
// never reach the chain-exhausted block below. This records whether the latest
// terminal failure for each provider was key-limit-shaped, so the
// breaker-open path can still carry the signal to the route (maintenance
// message + quota refund instead of the generic failure).
const providerKeyLimitActive = new Map<string, boolean>();

const setProviderKeyLimitActive = (provider: string, active: boolean): void => {
  providerKeyLimitActive.set(provider, active);
};

const isProviderKeyLimitActive = (provider: string): boolean =>
  providerKeyLimitActive.get(provider) === true;

/** Test hook: drop the key-limit signal alongside the breakers. */
export const resetProviderKeyLimitForTests = (): void => {
  providerKeyLimitActive.clear();
};

// #350 N2: the chain-exhausted verdict ORs the key-limit signal across every
// model attempt — the first 403 "Key limit exceeded" proves the key dead even
// if a later attempt fails differently.
const orKeyLimitSignal = (seen: boolean, status?: number, details?: string): boolean =>
  seen || isProviderKeyLimitError({ upstreamStatus: status, details });

export const validateStructuredResponseText = (
  text: string,
  responseSchema?: Record<string, unknown>,
): unknown => {
  if (!responseSchema) return undefined;
  let parsed: unknown;
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(
      `Structured response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as { text?: unknown }).text !== 'string'
  ) {
    throw new Error('Structured response must be an object containing text:string');
  }
  return parsed;
};

// #633: ajv checks the full schema on the anthropic/ branch, where the schema
// is sent as instructions and nothing else enforces it. strict:false lets the
// existing keywords (anyOf, oneOf, min/max) compile. Compiled once per schema
// object; the DM schema is a module constant, so this is one compile per process.
const schemaAjv = new Ajv({ strict: false, allErrors: false });
const compiledSchemaValidators = new WeakMap<Record<string, unknown>, ValidateFunction>();

const compiledSchemaValidator = (schema: Record<string, unknown>): ValidateFunction => {
  let validate = compiledSchemaValidators.get(schema);
  if (!validate) {
    validate = schemaAjv.compile(schema);
    compiledSchemaValidators.set(schema, validate);
  }
  return validate;
};

/** #782 item 2: text:string check, then the full schema. Runs on every path
 * (Anthropic instructed branch, OpenRouter strict branch, direct Gemini) —
 * providers may silently ignore unsupported keywords, so the schema is
 * enforced here regardless of what was sent. */
const validateFullSchemaText = (text: string, responseSchema: Record<string, unknown>): void => {
  const parsed = validateStructuredResponseText(text, responseSchema);
  const validate = compiledSchemaValidator(responseSchema);
  if (!validate(parsed)) {
    throw new Error(
      `Structured response does not match schema: ${schemaAjv.errorsText(validate.errors)}`,
    );
  }
};

/**
 * Strict-branch schema check mode, read once from LLM_STRICT_BRANCH_VALIDATION.
 * `shadow` (default): text:string is a hard check; the full schema is checked
 * and mismatches are logged (LLM_SCHEMA_SHADOW_INVALID) but the reply is kept.
 * `enforce`: the full schema is a hard check on the strict branch too.
 */
export type StrictBranchValidationMode = 'shadow' | 'enforce';
let strictBranchValidationMode: StrictBranchValidationMode =
  process.env.LLM_STRICT_BRANCH_VALIDATION?.trim().toLowerCase() === 'enforce'
    ? 'enforce'
    : 'shadow';

/** Test hook: switch the mode without reloading the module. */
export const setStrictBranchValidationModeForTests = (mode: StrictBranchValidationMode): void => {
  strictBranchValidationMode = mode;
};

/**
 * Strict branch (OpenRouter json_schema candidates, direct Gemini). Returns the
 * number of shadow-mode schema mismatches (0 or 1). Throws on a hard failure.
 * The shadow log carries no reply text: model plus the first ajv error's
 * instancePath, keyword and message.
 */
const validateStrictBranchText = (
  text: string,
  responseSchema: Record<string, unknown>,
  model: string,
): number => {
  if (strictBranchValidationMode === 'enforce') {
    validateFullSchemaText(text, responseSchema);
    return 0;
  }
  const parsed = validateStructuredResponseText(text, responseSchema);
  const validate = compiledSchemaValidator(responseSchema);
  if (validate(parsed)) return 0;
  const first = validate.errors?.[0];
  logger.warn({
    msg: 'LLM_SCHEMA_SHADOW_INVALID',
    model,
    instancePath: first?.instancePath ?? '',
    keyword: first?.keyword ?? '',
    message: first?.message ?? '',
  });
  return 1;
};

/**
 * Check if error indicates model is unavailable
 */
const isModelUnavailableError = (status: number, message: string) => {
  if (status === 404) return true;
  if (status === 400) {
    return (
      /model\s+(id\s+)?['"]?[^'"\s]+['"]?\s+is\s+not\s+valid/i.test(message) ||
      /unsupported\s+model/i.test(message) ||
      /could\s+not\s+be\s+resolved/i.test(message)
    );
  }
  return false;
};

/**
 * Parse model name from full path
 */
const parseModelName = (name: string | undefined): string | null => {
  if (!name) return null;
  const cleaned = name.trim();
  if (!cleaned) return null;
  const lastSlash = cleaned.lastIndexOf('/');
  return lastSlash >= 0 ? cleaned.slice(lastSlash + 1) : cleaned;
};

/**
 * Build list of model candidates to try
 */
/**
 * Get available Gemini model IDs (cached)
 */
const getGeminiModelIds = async (apiKey: string): Promise<Set<string>> => {
  const now = Date.now();
  if (geminiModelCache && now - geminiModelCache.fetchedAt < GEMINI_MODEL_CACHE_TTL_MS) {
    return geminiModelCache.ids;
  }

  const ids = new Set<string>();
  const versions: Array<'v1' | 'v1beta'> = ['v1', 'v1beta'];

  for (const version of versions) {
    let pageToken: string | undefined;
    let safety = 0;
    do {
      const url = new URL(`https://generativelanguage.googleapis.com/${version}/models`);
      url.searchParams.set('key', apiKey);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const resp = await fetch(url.toString(), {
        signal: AbortSignal.timeout(TEXT_PROVIDER_TIMEOUT_MS),
      });
      if (!resp.ok) break;
      const data = (await resp.json()) as {
        models?: Array<{ name?: string }>;
        nextPageToken?: string;
      };
      for (const model of data.models || []) {
        const parsed = parseModelName(model.name);
        if (parsed) ids.add(parsed);
      }
      pageToken = data.nextPageToken;
      safety += 1;
    } while (pageToken && safety < 5);
  }

  geminiModelCache = { ids, fetchedAt: now };
  return ids;
};

/**
 * Pick appropriate Gemini API version for model
 */
const pickGeminiApiVersion = (modelId: string): 'v1' | 'v1beta' => {
  return /^gemini-2\.5-/i.test(modelId) ? 'v1' : 'v1beta';
};

type OpenRouterStreamUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
};

type OpenRouterStreamResult = {
  text: string;
  usage?: OpenRouterStreamUsage;
  /** #750 step 2: the last non-null `choices[0].finish_reason` seen on the stream. */
  finishReason?: string;
  /** A provider `error` event arrived on the stream after HTTP 200. */
  streamError?: string;
};

/**
 * #633 PR2: consume an OpenRouter chat-completions SSE stream (`stream: true`).
 * Fires `onToken` once per `choices[0].delta.content` increment, accumulates
 * the full completion text, and captures the `usage` object OpenRouter sends
 * on the final chunk. `:` keepalive comment lines are skipped; the stream
 * ends at `data: [DONE]`.
 */
const consumeOpenRouterStream = async (
  response: Response,
  onToken: (deltaText: string) => void,
): Promise<OpenRouterStreamResult> => {
  const result: OpenRouterStreamResult = { text: '' };
  if (!response.body) return { ...result, streamError: 'empty response body' };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handleData = (data: string): void => {
    if (data === '[DONE]') return;
    let chunk: {
      choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
      usage?: OpenRouterStreamUsage;
      error?: { message?: string } | string;
    };
    try {
      chunk = JSON.parse(data) as typeof chunk;
    } catch {
      return;
    }
    if (chunk.error) {
      result.streamError =
        typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? 'stream error');
      return;
    }
    const delta = chunk.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      result.text += delta;
      onToken(delta);
    }
    const finishReason = chunk.choices?.[0]?.finish_reason;
    if (typeof finishReason === 'string' && finishReason.length > 0) {
      result.finishReason = finishReason;
    }
    if (chunk.usage) result.usage = chunk.usage;
  };
  const handleBlock = (block: string): void => {
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const match = /^data:\s?(.*?)\r?$/.exec(line);
      if (match) handleData(match[1]);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      handleBlock(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  // Flush any buffered partial character, then a trailing event without a
  // terminating blank line (defensive).
  buffer += decoder.decode();
  if (buffer.length > 0) handleBlock(buffer);
  return result;
};

export class LLMProviderService {
  /**
   * Generate text via OpenRouter or Gemini
   */
  static async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const {
      prompt,
      systemPrompt,
      model,
      maxTokens = 1000,
      temperature = 0.8,
      history,
      provider = 'openrouter',
      responseSchema,
      onToken,
      onAttemptStart,
    } = options;

    try {
      if (provider === 'openrouter') {
        return await this.generateOpenRouter(
          prompt,
          model,
          maxTokens,
          temperature,
          history,
          responseSchema,
          systemPrompt,
          onToken,
          onAttemptStart,
        );
      }

      if (provider === 'gemini') {
        return await this.generateGemini(
          prompt,
          model,
          maxTokens,
          temperature,
          history,
          responseSchema,
          systemPrompt,
        );
      }

      return { error: 'Unsupported provider', status: 400, text: '' };
    } catch (e) {
      logger.error({ msg: 'LLM_PROVIDER_ERROR', error: e });
      if (e instanceof CircuitOpenError) {
        // #350 B1: the breaker opens after 3 consecutive failures. During a
        // key-limit outage most degraded turns take this path, not the
        // chain-exhausted one below — carry the signal so the route still
        // shows the maintenance message and refunds the quota unit.
        const keyLimit = isProviderKeyLimitActive(provider);
        if (keyLimit) {
          logger.error({ msg: 'LLM_PROVIDER_KEY_LIMIT_CIRCUIT_OPEN', provider });
        }
        return {
          error: 'Provider temporarily unavailable',
          status: 503,
          provider: provider === 'gemini' ? 'gemini' : 'openrouter',
          retryAfter: e.retryAfterSec,
          ...(keyLimit ? { upstreamStatus: 403, providerKeyLimit: true } : {}),
          text: '',
        };
      }
      if (e instanceof LLMUpstreamError) {
        logger.error({
          msg: 'LLM_UPSTREAM_MODEL_ERROR',
          provider: e.provider,
          model: e.model,
          upstreamStatus: e.upstreamStatus,
          retryable: e.retryable,
          error: e.message,
        });
        return {
          error: 'LLM request failed',
          status: 502,
          provider: e.provider,
          model: e.model,
          upstreamStatus: e.upstreamStatus,
          retryable: e.retryable,
          text: '',
        };
      }
      if (e instanceof DOMException && e.name === 'TimeoutError') {
        getCircuitBreaker(`llm:${provider}`).onFailure();
        return {
          error: 'Provider timed out; retry the request',
          status: 503,
          retryAfter: 1,
          text: '',
        };
      }
      return { error: 'LLM request failed', status: 500, text: '' };
    }
  }

  /**
   * Internal OpenRouter implementation
   */
  private static async generateOpenRouter(
    prompt: string,
    model?: string,
    maxTokens = 1000,
    temperature = 0.8,
    history?: ChatMessage[],
    responseSchema?: Record<string, unknown>,
    systemPrompt?: string,
    onToken?: (deltaText: string) => void,
    onAttemptStart?: () => void,
  ): Promise<LLMResponse> {
    const breaker = getCircuitBreaker('llm:openrouter');
    breaker.allowOrThrow();

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { error: 'Service unavailable', status: 500, text: '' };
    }

    const textModel =
      model?.trim() || process.env.OPENROUTER_TEXT_MODEL || DEFAULT_OPENROUTER_TEXT_MODEL;
    const unsupportedStructuredModels = new Set(getStructuredOutputUnsupportedModels());
    const candidateModels = getOpenRouterModelCandidates(textModel).filter((candidate) => {
      const allowed = !responseSchema || !unsupportedStructuredModels.has(candidate);
      if (!allowed) {
        logger.warn({
          msg: 'LLM_OPENROUTER_MODEL_SKIPPED_UNSUPPORTED_STRUCTURED_OUTPUT',
          model: candidate,
        });
      }
      return allowed;
    });
    // #352: the stable system block goes first so the provider caches on the
    // prompt prefix; history and the volatile user prompt follow.
    // #633 PR3: the `cache_control` breakpoint below is the request's ONLY
    // cache marker. It sits on the system block because that block is
    // byte-identical across turns in the same combat state (see
    // buildSystemPrompt in src/services/ai/prompt-assembly.ts) — the ~8k
    // stable prefix the provider caches. History and the user message stay
    // plain strings with no marker: they change every turn and must never be
    // part of the cached prefix.
    const buildMessages = (systemText: string | undefined): OpenRouterChatMessage[] => {
      const built: OpenRouterChatMessage[] = [];
      if (typeof systemText === 'string' && systemText.length > 0) {
        built.push({
          role: 'system',
          content: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
        });
      }
      if (Array.isArray(history)) {
        for (const m of history) {
          if (m && m.role && typeof m.content === 'string') {
            built.push(m);
          }
        }
      }
      built.push({ role: 'user', content: prompt });
      return built;
    };
    const messages = buildMessages(systemPrompt);
    // #633: Anthropic candidates cannot take strict json_schema, so the schema
    // rides in the stable system text instead (same cache block, so it is
    // byte-identical across turns). Built once; candidates pick, never mutate.
    // #783: the volatile user message carries a JSON reminder. The conversation
    // still ends with that user message: Haiku 5.5 rejects an assistant prefill.
    const instructedMessages: OpenRouterChatMessage[] = responseSchema
      ? ((): OpenRouterChatMessage[] => {
          const built = buildMessages(
            [systemPrompt, `${SCHEMA_INSTRUCTION_LINE}\n${JSON.stringify(responseSchema)}`]
              .filter((part): part is string => typeof part === 'string' && part.length > 0)
              .join('\n\n'),
          );
          built[built.length - 1] = {
            role: 'user',
            content: `${prompt}\n\n${JSON_REMINDER_LINE}`,
          };
          return built;
        })()
      : messages;

    type ORChatResp = {
      choices?: { message?: { content?: string }; finish_reason?: string | null }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
      };
    };
    const attempts: string[] = [];
    let lastFailure: { status: number; details: string; retryAfter?: number } | null = null;
    // #350 N2: OR the key-limit signal across attempts (see orKeyLimitSignal).
    let keyLimitSeen = false;
    // LLM_STRICT_BRANCH_VALIDATION=shadow: count of accepted replies that failed the full schema.
    let schemaShadowInvalid = 0;

    for (let index = 0; index < candidateModels.length; index += 1) {
      const candidate = candidateModels[index];
      // #782 item 4: the capability profile replaces the scattered
      // modelSupportsStrictSchema conditional.
      const profile = getVendorCapabilityProfile(candidate);
      const strictSchema = !responseSchema || profile.strictJsonSchema;
      // #783: only the strict json_schema request needs provider routing
      // constrained. The instructed-schema and schema-less paths send no
      // `provider` field.
      const strictRequest = Boolean(responseSchema && strictSchema);
      const reqBody = {
        model: candidate,
        messages: strictSchema ? messages : instructedMessages,
        max_tokens: maxTokens,
        // #783: omitted for vendors whose OpenRouter endpoints reject
        // `temperature` alongside require_parameters (anthropic/).
        ...(profile.supportsTemperature ? { temperature } : {}),
        // #352: ask OpenRouter for the usage detail object so cache hits are
        // visible (`usage.prompt_tokens_details.cached_tokens`).
        usage: { include: true },
        // #782 item 4 / #783: route the strict json_schema request only to
        // providers that support its parameters, so the schema is never
        // silently dropped.
        ...(strictRequest ? { provider: { require_parameters: true } } : {}),
        // #633 PR2: stream tokens when the caller wants progress callbacks.
        // Usage rides the final stream chunk automatically.
        ...(onToken ? { stream: true } : {}),
        ...(strictRequest
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'structured_response', strict: true, schema: responseSchema },
              },
            }
          : {}),
      };

      for (let retry = 0; retry < (responseSchema ? 2 : 1); retry += 1) {
        attempts.push(candidate);
        onAttemptStart?.();
        try {
          const response = await llmFetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.APP_ORIGIN || 'http://localhost:5173',
              'X-Title': 'AI Adventure Scribe',
            },
            body: JSON.stringify(reqBody),
            signal: AbortSignal.timeout(TEXT_PROVIDER_TIMEOUT_MS),
          });

          if (response.ok) {
            let text: string;
            let usage: ORChatResp['usage'] | undefined;
            let finishReason: string | null | undefined;
            if (onToken) {
              // #633 PR2: accumulate the streamed completion, firing the
              // token callback per delta. Everything below (validation,
              // retry, usage accounting) is shared with the non-stream path.
              const streamed = await consumeOpenRouterStream(response, onToken);
              if (streamed.streamError) {
                lastFailure = { status: 502, details: streamed.streamError };
                logger.warn({
                  msg: 'LLM_OPENROUTER_STREAM_EVENT_ERROR',
                  model: candidate,
                  retry: retry + 1,
                  error: streamed.streamError,
                });
                continue;
              }
              text = streamed.text;
              usage = streamed.usage;
              finishReason = streamed.finishReason;
            } else {
              const data = (await response.json()) as ORChatResp;
              text = data.choices?.[0]?.message?.content ?? '';
              usage = data.usage;
              finishReason = data.choices?.[0]?.finish_reason;
            }
            if (responseSchema) {
              try {
                // #782 item 2: full schema on every path. The strict branch
                // used to trust the provider's enforcement; providers may
                // silently ignore unsupported keywords, so validate here too.
                // The strict branch runs in shadow mode by default (see
                // validateStrictBranchText); the instructed branch is always hard.
                if (strictSchema) {
                  schemaShadowInvalid += validateStrictBranchText(text, responseSchema, candidate);
                } else {
                  validateFullSchemaText(text, responseSchema);
                }
              } catch (validationError) {
                lastFailure = {
                  status: 502,
                  details:
                    validationError instanceof Error
                      ? validationError.message
                      : String(validationError),
                };
                // #350 FIX round 2: validation text is local, not upstream —
                // never feed it into the key-limit verdict (a model reply
                // containing "limit" must not page). The 502 status also gates
                // message matching in isProviderKeyLimitError.
                // #783: a prose reply on the instructed branch will not improve on
                // a same-prompt retry — fail over to the next candidate now.
                const proseReply =
                  !strictSchema &&
                  lastFailure.details.startsWith('Structured response is not valid JSON');
                logger.warn({
                  msg: 'LLM_OPENROUTER_STRUCTURED_RESPONSE_INVALID',
                  model: candidate,
                  retry: retry + 1,
                  error: lastFailure.details,
                  ...(proseReply ? { proseReply: true } : {}),
                });
                if (proseReply) break;
                continue;
              }
            }
            breaker.onSuccess();
            // #350 B1: the key works again — drop the key-limit signal so a
            // later breaker-open (from unrelated failures) is not misread.
            setProviderKeyLimitActive('openrouter', false);
            const inputTokens = usage?.prompt_tokens ?? 0;
            const outputTokens = usage?.completion_tokens ?? 0;
            // #750 step 2: surface a provider-truncated reply (hit the token
            // ceiling) so a cut-off turn is visible in logs. Never logs reply
            // or prompt text.
            if (isTruncatedFinishReason(finishReason)) {
              logger.warn({
                msg: 'LLM_REPLY_TRUNCATED',
                provider: 'openrouter',
                model: candidate,
                finishReason,
                maxTokens,
                ...(outputTokens > 0 ? { outputTokens } : {}),
              });
            }
            // #352: prompt-cache accounting. Absent details mean no cache
            // information (older path or provider without caching).
            const cachedInputTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
            const cacheWriteTokens = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
            return {
              text,
              model: candidate,
              provider: 'openrouter',
              usage: {
                inputTokens,
                outputTokens,
                totalTokens: usage?.total_tokens ?? inputTokens + outputTokens,
                cachedInputTokens,
                cacheWriteTokens,
                // #782 item 4: log which schema-delivery path this turn used.
                // Only meaningful when a schema was requested.
                ...(responseSchema
                  ? {
                      schemaDelivery: strictSchema
                        ? ('strict-json-schema' as const)
                        : ('schema-as-instructions' as const),
                    }
                  : {}),
                ...(schemaShadowInvalid > 0 ? { schemaShadowInvalid } : {}),
              },
            };
          }

          const errText = await response.text();
          lastFailure = {
            status: response.status,
            details: errText,
            retryAfter: retryAfterSeconds(response),
          };
          keyLimitSeen = orKeyLimitSignal(keyLimitSeen, lastFailure.status, lastFailure.details);
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          lastFailure = { status: 503, details, retryAfter: 1 };
          keyLimitSeen = orKeyLimitSignal(keyLimitSeen, lastFailure.status, lastFailure.details);
        }
        if (retry === 0 && responseSchema) continue;
      }
      const nextCandidate = candidateModels[index + 1];
      if (nextCandidate) logFailover(candidate, nextCandidate, lastFailure?.status);
    }

    breaker.onFailure();
    const upstreamStatus = lastFailure?.status ?? 503;
    const retryable = isRetryableUpstreamStatus(upstreamStatus);
    // #350 B2: compute the key-limit verdict once — OR'd across every model
    // attempt (N2) — and carry it on the result, so the alert and the route
    // honor the same determination.
    const keyLimit = orKeyLimitSignal(keyLimitSeen, upstreamStatus, lastFailure?.details);
    setProviderKeyLimitActive('openrouter', keyLimit);
    logger.error({
      msg: 'LLM_OPENROUTER_CHAIN_EXHAUSTED',
      provider: 'openrouter',
      model: textModel,
      upstreamStatus,
      retryable,
      attempts,
      keyLimit,
      details: lastFailure?.details,
    });
    // #350: a dead provider key degrades every turn silently; page once per 15 min.
    if (keyLimit) {
      alertProviderKeyLimit({ provider: 'openrouter', upstreamStatus });
    }
    return {
      error: 'LLM request failed',
      status: upstreamStatus,
      provider: 'openrouter',
      model: textModel,
      upstreamStatus,
      retryable,
      providerKeyLimit: keyLimit,
      details: process.env.NODE_ENV !== 'production' ? lastFailure?.details : undefined,
      attempts: process.env.NODE_ENV !== 'production' ? attempts : undefined,
      retryAfter: lastFailure?.retryAfter ?? (retryable ? 2 : undefined),
      text: '',
    };
  }

  /**
   * Internal Gemini implementation
   */
  private static async generateGemini(
    prompt: string,
    model?: string,
    maxTokens = 1000,
    temperature = 0.8,
    history?: ChatMessage[],
    responseSchema?: Record<string, unknown>,
    systemPrompt?: string,
  ): Promise<LLMResponse> {
    const breaker = getCircuitBreaker('llm:gemini');
    breaker.allowOrThrow();

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return { error: 'Service unavailable', status: 500, text: '' };
    }

    const preferredModel =
      typeof model === 'string' && model.trim()
        ? model.trim()
        : process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_TEXT_MODEL;
    const candidateModels = getGeminiModelCandidates(preferredModel);

    const toGeminiRole = (role: ChatMessage['role']): 'user' | 'model' => {
      if (role === 'assistant') {
        return 'model';
      }
      return 'user';
    };

    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    if (Array.isArray(history)) {
      for (const m of history) {
        if (m?.content && m.role) {
          contents.push({ role: toGeminiRole(m.role), parts: [{ text: m.content }] });
        }
      }
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const geminiBody: any = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
      },
      // #352: the stable system block travels as Gemini's native system
      // instruction, so implicit prompt caching sees the same stable prefix.
      ...(typeof systemPrompt === 'string' && systemPrompt.length > 0
        ? { systemInstruction: { parts: [{ text: systemPrompt }] } }
        : {}),
    };

    const attempts: string[] = [];
    let successPayload: any = null;
    let successModel: string | null = null;
    let lastFailure: { status: number; details: string; retryAfter?: number } | null = null;
    // #350 N2: OR the key-limit signal across attempts (see orKeyLimitSignal).
    let keyLimitSeen = false;
    let availableModels: Set<string> | null = null;
    // LLM_STRICT_BRANCH_VALIDATION=shadow: count of accepted replies that failed the full schema.
    let schemaShadowInvalid = 0;

    for (let index = 0; index < candidateModels.length; index += 1) {
      const candidate = candidateModels[index];
      const version = pickGeminiApiVersion(candidate);
      for (let retry = 0; retry < (responseSchema ? 2 : 1); retry += 1) {
        attempts.push(`${candidate} [${version}]`);
        let response: Response;
        try {
          response = await llmFetch(
            `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(geminiBody),
              signal: AbortSignal.timeout(TEXT_PROVIDER_TIMEOUT_MS),
            },
          );
        } catch (error) {
          lastFailure = {
            status: 503,
            details: error instanceof Error ? error.message : String(error),
            retryAfter: 1,
          };
          keyLimitSeen = orKeyLimitSignal(keyLimitSeen, lastFailure.status, lastFailure.details);
          break;
        }

        if (response.ok) {
          const payload = await response.json();
          if (responseSchema) {
            const candidateText = ((payload as any)?.candidates?.[0]?.content?.parts || [])
              .map((part: { text?: string }) => part?.text)
              .filter(Boolean)
              .join('\n');
            try {
              schemaShadowInvalid += validateStrictBranchText(
                candidateText,
                responseSchema,
                candidate,
              );
            } catch (validationError) {
              lastFailure = {
                status: 502,
                details:
                  validationError instanceof Error
                    ? validationError.message
                    : String(validationError),
              };
              // #350 FIX round 2: validation text is local, not upstream —
              // never feed it into the key-limit verdict (a model reply
              // containing "limit" must not page). The 502 status also gates
              // message matching in isProviderKeyLimitError.
              logger.warn({
                msg: 'LLM_GEMINI_STRUCTURED_RESPONSE_INVALID',
                model: candidate,
                retry: retry + 1,
                error: lastFailure.details,
              });
              continue;
            }
          }
          successPayload = payload;
          successModel = candidate;
          break;
        }

        const errText = await response.text();
        lastFailure = {
          status: response.status,
          details: errText,
          retryAfter: retryAfterSeconds(response),
        };
        keyLimitSeen = orKeyLimitSignal(keyLimitSeen, lastFailure.status, lastFailure.details);

        if (isModelUnavailableError(response.status, errText)) {
          if (!availableModels) {
            try {
              availableModels = await getGeminiModelIds(apiKey);
            } catch (fetchErr) {
              logger.warn({ msg: 'LLM_GEMINI_MODEL_LIST_FETCH_FAILED', error: fetchErr });
            }
          }
          if (availableModels && !availableModels.has(candidate)) {
            logger.warn({
              msg: 'LLM_GEMINI_MODEL_UNAVAILABLE',
              candidate,
              available: Array.from(availableModels).join(', '),
            });
          } else {
            logger.warn({ msg: 'LLM_GEMINI_MODEL_REJECTED', candidate, errText });
          }
          break;
        }

        logger.warn({
          msg: 'LLM_GEMINI_REQUEST_FAILED',
          candidate,
          status: response.status,
          errText,
        });
        break;
      }
      if (successPayload && successModel) break;
      const nextCandidate = candidateModels[index + 1];
      if (nextCandidate) logFailover(candidate, nextCandidate, lastFailure?.status);
    }

    if (!successPayload || !successModel) {
      breaker.onFailure();
      const status = lastFailure?.status ?? 400;
      const details =
        lastFailure?.details || `All Gemini model attempts failed. Tried: ${attempts.join(', ')}`;
      const retryable = isRetryableUpstreamStatus(status);
      // #350 B2: compute the key-limit verdict once — OR'd across every model
      // attempt (N2) — and carry it on the result, so the alert and the route
      // honor the same determination.
      const keyLimit = orKeyLimitSignal(keyLimitSeen, status, lastFailure?.details);
      setProviderKeyLimitActive('gemini', keyLimit);
      logger.error({
        msg: 'LLM_GEMINI_CHAIN_EXHAUSTED',
        provider: 'gemini',
        model: preferredModel,
        upstreamStatus: status,
        retryable,
        attempts,
        keyLimit,
        details,
      });
      // #350: a dead provider key degrades every turn silently; page once per 15 min.
      if (keyLimit) {
        alertProviderKeyLimit({ provider: 'gemini', upstreamStatus: status });
      }
      return {
        error: 'LLM request failed',
        status,
        provider: 'gemini',
        model: preferredModel,
        upstreamStatus: status,
        retryable,
        providerKeyLimit: keyLimit,
        details: process.env.NODE_ENV !== 'production' ? details : undefined,
        attempts: process.env.NODE_ENV !== 'production' ? attempts : undefined,
        retryAfter: lastFailure?.retryAfter ?? (retryable ? 2 : undefined),
        text: '',
      };
    }

    if (successModel !== preferredModel) {
      logger.warn({
        msg: 'LLM_GEMINI_FALLBACK',
        requested: preferredModel,
        using: successModel,
        attempts: attempts.join(', '),
      });
    }

    breaker.onSuccess();
    // #350 B1: the key works again — drop the key-limit signal so a
    // later breaker-open (from unrelated failures) is not misread.
    setProviderKeyLimitActive('gemini', false);
    const data = successPayload as any;
    const candidates = data?.candidates || [];
    const first = candidates[0];
    const parts: Array<{ text?: string }> = first?.content?.parts || [];
    const text = parts
      .map((p) => p?.text)
      .filter(Boolean)
      .join('\n');
    const metadata = data?.usageMetadata || {};
    const inputTokens = Number(metadata.promptTokenCount || 0);
    const outputTokens = Number(metadata.candidatesTokenCount || 0);
    // #750 step 2: Gemini reports `candidates[0].finishReason`; MAX_TOKENS
    // means the reply was cut at maxOutputTokens. Never logs reply text.
    if (isTruncatedFinishReason(first?.finishReason)) {
      logger.warn({
        msg: 'LLM_REPLY_TRUNCATED',
        provider: 'gemini',
        model: successModel,
        finishReason: first.finishReason,
        maxTokens,
        ...(outputTokens > 0 ? { outputTokens } : {}),
      });
    }
    return {
      text: text || '',
      model: successModel,
      provider: 'gemini',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: Number(metadata.totalTokenCount || inputTokens + outputTokens),
        // #352: Gemini's implicit cache read count for this turn.
        cachedInputTokens: Number(metadata.cachedContentTokenCount || 0),
        // #782 item 4: Gemini always takes the strict schema path, when a
        // schema was requested.
        ...(responseSchema ? { schemaDelivery: 'strict-json-schema' as const } : {}),
        ...(schemaShadowInvalid > 0 ? { schemaShadowInvalid } : {}),
      },
    };
  }

  /**
   * Extract memories via LLM
   */
  static async extract(options: LLMExtractOptions): Promise<LLMResponse> {
    const { prompt, maxTokens = 1000 } = options;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { error: 'Service unavailable', status: 500, text: '' };
    }

    const models = getOpenRouterExtractionModelCandidates();
    let lastFailure: { model: string; status: number; details: string } | null = null;

    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      try {
        const reqBody = {
          model,
          messages,
          max_tokens: maxTokens,
          // Lower temp for structured extraction. #783: omitted for vendors
          // that reject `temperature` (same gate as the chat path).
          ...(getVendorCapabilityProfile(model).supportsTemperature ? { temperature: 0.3 } : {}),
        };

        const response = await llmFetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_ORIGIN || 'http://localhost:5173',
            'X-Title': 'AI Adventure Scribe - Memory Extraction',
          },
          body: JSON.stringify(reqBody),
          signal: AbortSignal.timeout(TEXT_PROVIDER_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastFailure = { model, status: response.status, details: errText };
          logger.warn({ msg: 'LLM_EXTRACT_MODEL_FAILED', model, status: response.status, errText });
          const nextModel = models[index + 1];
          if (nextModel) logFailover(model, nextModel, lastFailure.status);
          continue; // Try next model
        }

        type ORChatResp = {
          choices?: { message?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const data = (await response.json()) as ORChatResp;
        const text: string = data.choices?.[0]?.message?.content ?? '';

        logger.info({
          msg: 'LLM_EXTRACT_SUCCESS',
          model,
          promptLength: prompt.length,
          responseLength: text.length,
        });
        const inputTokens = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;
        return {
          text,
          model,
          provider: 'openrouter',
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: data.usage?.total_tokens ?? inputTokens + outputTokens,
          },
        };
      } catch (err) {
        lastFailure = {
          model,
          status: 503,
          details: err instanceof Error ? err.message : String(err),
        };
        logger.warn({ msg: 'LLM_EXTRACT_ERROR', model, error: err });
        const nextModel = models[index + 1];
        if (nextModel) logFailover(model, nextModel, lastFailure.status);
        continue; // Try next model
      }
    }

    // All models failed. Keep the final provider status for the route-level 502 mapping.
    const lastModel = lastFailure?.model || models[models.length - 1];
    const upstreamStatus = lastFailure?.status || 503;
    const retryable = isRetryableUpstreamStatus(upstreamStatus);
    logger.error({ msg: 'LLM_EXTRACT_ALL_FAILED', models });
    return {
      error: 'All extraction models failed',
      status: upstreamStatus,
      provider: 'openrouter',
      model: lastModel,
      upstreamStatus,
      retryable,
      details: process.env.NODE_ENV !== 'production' ? lastFailure?.details : undefined,
      text: '',
    };
  }
}
