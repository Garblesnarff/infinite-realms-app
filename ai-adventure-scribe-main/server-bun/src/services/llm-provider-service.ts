import { logger } from '../lib/logger.js';
import { getCircuitBreaker, CircuitOpenError } from '../utils/circuit-breaker.js';
import { isRetryableUpstreamStatus, LLMUpstreamError } from './llm-errors.js';
import {
  DEFAULT_GEMINI_TEXT_MODEL,
  DEFAULT_OPENROUTER_EXTRACTION_FALLBACK_MODEL,
  DEFAULT_OPENROUTER_EXTRACTION_MODEL,
  DEFAULT_OPENROUTER_TEXT_MODEL,
  getGeminiModelCandidates,
  getOpenRouterModelCandidates,
} from './llm-model-config.js';

/**
 * Extracted from routes/v1/llm.ts
 * Handles LLM generation logic for multiple providers (OpenRouter, Gemini)
 */

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export interface LLMGenerateOptions {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  history?: ChatMessage[];
  provider?: 'openrouter' | 'gemini';
  responseSchema?: Record<string, unknown>;
}

export interface LLMExtractOptions {
  prompt: string;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  model?: string;
  provider?: 'openrouter' | 'gemini';
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  error?: string;
  status?: number;
  details?: string;
  attempts?: string[];
  retryAfter?: number;
  upstreamStatus?: number;
  retryable?: boolean;
}

const GEMINI_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
export const TEXT_PROVIDER_TIMEOUT_MS = 60_000;
let geminiModelCache: { ids: Set<string>; fetchedAt: number } | null = null;

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

export class LLMProviderService {
  static async stream(options: LLMGenerateOptions): Promise<ReadableStream<Uint8Array>> {
    if (options.provider === 'gemini') {
      const result = await this.generate(options);
      if (result.error) throw new Error(result.error);
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(result.text));
          controller.close();
        },
      });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('Service unavailable');
    const model =
      options.model || process.env.OPENROUTER_TEXT_MODEL || DEFAULT_OPENROUTER_TEXT_MODEL;
    const messages = [
      ...(options.history || []),
      { role: 'user' as const, content: options.prompt },
    ];
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_ORIGIN || 'http://localhost:5173',
        'X-Title': 'AI Adventure Scribe',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? 1000,
        temperature: options.temperature ?? 0.8,
        ...(options.responseSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: 'structured_response',
                  strict: true,
                  schema: options.responseSchema,
                },
              },
            }
          : {}),
      }),
      signal: AbortSignal.timeout(TEXT_PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new LLMUpstreamError(
        'openrouter',
        model,
        response.status,
        `LLM stream failed (${response.status})`,
      );
    }
    if (!response.body) throw new Error(`LLM stream returned no body (${response.status})`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const payload = line.startsWith('data: ') ? line.slice(6) : '';
            if (!payload || payload === '[DONE]') continue;
            try {
              const json = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const content = json.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(content));
                return;
              }
            } catch {
              // Ignore provider keepalive or malformed SSE frames.
            }
          }
        }
      },
      cancel() {
        void reader.cancel();
      },
    });
  }

  /**
   * Generate text via OpenRouter or Gemini
   */
  static async generate(options: LLMGenerateOptions): Promise<LLMResponse> {
    const {
      prompt,
      model,
      maxTokens = 1000,
      temperature = 0.8,
      history,
      provider = 'openrouter',
      responseSchema,
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
        );
      }

      return { error: 'Unsupported provider', status: 400, text: '' };
    } catch (e) {
      logger.error({ msg: 'LLM_PROVIDER_ERROR', error: e });
      if (e instanceof CircuitOpenError) {
        return {
          error: 'Provider temporarily unavailable',
          status: 503,
          retryAfter: e.retryAfterSec,
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
  ): Promise<LLMResponse> {
    const breaker = getCircuitBreaker('llm:openrouter');
    breaker.allowOrThrow();

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return { error: 'Service unavailable', status: 500, text: '' };
    }

    const textModel =
      model?.trim() || process.env.OPENROUTER_TEXT_MODEL || DEFAULT_OPENROUTER_TEXT_MODEL;
    const candidateModels = getOpenRouterModelCandidates(textModel);
    const messages: ChatMessage[] = [];

    if (Array.isArray(history)) {
      for (const m of history) {
        if (m && m.role && typeof m.content === 'string') {
          messages.push(m);
        }
      }
    }
    messages.push({ role: 'user', content: prompt });

    type ORChatResp = {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const attempts: string[] = [];
    let lastFailure: { status: number; details: string } | null = null;
    let timedOut = false;

    for (let index = 0; index < candidateModels.length; index += 1) {
      const candidate = candidateModels[index];
      attempts.push(candidate);
      const reqBody = {
        model: candidate,
        messages,
        max_tokens: maxTokens,
        temperature,
        ...(responseSchema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'structured_response', strict: true, schema: responseSchema },
              },
            }
          : {}),
      };

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
          breaker.onSuccess();
          const data = (await response.json()) as ORChatResp;
          const text: string = data.choices?.[0]?.message?.content ?? '';
          const inputTokens = data.usage?.prompt_tokens ?? 0;
          const outputTokens = data.usage?.completion_tokens ?? 0;
          return {
            text,
            model: candidate,
            provider: 'openrouter',
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: data.usage?.total_tokens ?? inputTokens + outputTokens,
            },
          };
        }

        const errText = await response.text();
        lastFailure = { status: response.status, details: errText };
        const nextCandidate = candidateModels[index + 1];
        if (nextCandidate) {
          logger.warn({
            msg: 'LLM_OPENROUTER_FALLBACK',
            requested: textModel,
            failedModel: candidate,
            upstreamStatus: response.status,
            using: nextCandidate,
          });
        }
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        if (error instanceof DOMException && error.name === 'TimeoutError') timedOut = true;
        lastFailure = { status: 503, details };
        const nextCandidate = candidateModels[index + 1];
        if (nextCandidate) {
          logger.warn({
            msg: 'LLM_OPENROUTER_FALLBACK',
            requested: textModel,
            failedModel: candidate,
            error,
            using: nextCandidate,
          });
        }
      }
    }

    breaker.onFailure();
    const upstreamStatus = lastFailure?.status ?? 503;
    const retryable = isRetryableUpstreamStatus(upstreamStatus);
    logger.error({
      msg: 'LLM_OPENROUTER_CHAIN_EXHAUSTED',
      provider: 'openrouter',
      model: textModel,
      upstreamStatus,
      retryable,
      attempts,
      details: lastFailure?.details,
    });
    return {
      error: 'LLM request failed',
      status: upstreamStatus,
      provider: 'openrouter',
      model: textModel,
      upstreamStatus,
      retryable,
      details: process.env.NODE_ENV !== 'production' ? lastFailure?.details : undefined,
      attempts: process.env.NODE_ENV !== 'production' ? attempts : undefined,
      retryAfter: timedOut && upstreamStatus === 503 ? 1 : undefined,
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
    };

    const attempts: string[] = [];
    let successPayload: any = null;
    let successModel: string | null = null;
    let lastFailure: { status: number; details: string } | null = null;
    let availableModels: Set<string> | null = null;

    for (const candidate of candidateModels) {
      const version = pickGeminiApiVersion(candidate);
      attempts.push(`${candidate} [${version}]`);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
          signal: AbortSignal.timeout(TEXT_PROVIDER_TIMEOUT_MS),
        },
      );

      if (response.ok) {
        successPayload = await response.json();
        successModel = candidate;
        break;
      }

      const errText = await response.text();
      lastFailure = { status: response.status, details: errText };

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
        continue;
      }

      logger.warn({
        msg: 'LLM_GEMINI_REQUEST_FAILED',
        candidate,
        status: response.status,
        errText,
      });
    }

    if (!successPayload || !successModel) {
      breaker.onFailure();
      const status = lastFailure?.status ?? 400;
      const details =
        lastFailure?.details || `All Gemini model attempts failed. Tried: ${attempts.join(', ')}`;
      const retryable = isRetryableUpstreamStatus(status);
      logger.error({
        msg: 'LLM_GEMINI_CHAIN_EXHAUSTED',
        provider: 'gemini',
        model: preferredModel,
        upstreamStatus: status,
        retryable,
        attempts,
        details,
      });
      return {
        error: 'LLM request failed',
        status,
        provider: 'gemini',
        model: preferredModel,
        upstreamStatus: status,
        retryable,
        details: process.env.NODE_ENV !== 'production' ? details : undefined,
        attempts: process.env.NODE_ENV !== 'production' ? attempts : undefined,
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
    return {
      text: text || '',
      model: successModel,
      provider: 'gemini',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: Number(metadata.totalTokenCount || inputTokens + outputTokens),
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

    // Models to try: free primary, cheap fallback
    const models = [
      process.env.OPENROUTER_EXTRACTION_MODEL || DEFAULT_OPENROUTER_EXTRACTION_MODEL,
      process.env.OPENROUTER_EXTRACTION_FALLBACK_MODEL ||
        DEFAULT_OPENROUTER_EXTRACTION_FALLBACK_MODEL,
    ];
    let lastFailure: { model: string; status: number; details: string } | null = null;

    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

    for (const model of models) {
      try {
        const reqBody = {
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.3, // Lower temp for structured extraction
        };

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
