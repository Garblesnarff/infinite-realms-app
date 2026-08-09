import { waitForAuth } from '@/lib/auth-gate';
import logger from '@/lib/logger';
import { getAuthHeaders } from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export class ApiClientError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface LLMHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateTextParams {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  history?: LLMHistoryMessage[];
  provider?: 'openrouter' | 'gemini';
  responseSchema?: Record<string, unknown>;
  onStream?: (chunk: string) => void;
  requestType?: 'user' | 'system';
  onResponseMetadata?: (metadata: { provider?: 'openrouter' | 'gemini'; model?: string }) => void;
  /**
   * Optional, numbers-only per-section prompt token telemetry (log-only on the
   * server -- see #1688). No prompt content, just counts. Omitted entirely if
   * the caller didn't compute it or computation failed.
   */
  metrics?: Record<string, number>;
}

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  referenceImage?: string; // deprecated single-image form
  referenceImages?: string[];
  quality?: 'low' | 'medium' | 'high';
}

export interface AppendMessageImageParams {
  messageId: string;
  image: { url: string; prompt?: string; model?: string; quality?: 'low' | 'medium' | 'high' };
}

export interface ImageQuotaStatus {
  plan: string;
  limits: { daily: { llm: number; image: number; voice: number } };
  usage: number;
  remaining: number;
  resetAt: string;
}

class LlmApiClient {
  private useOfflineFallback = false;
  private offlineFallbackSetAt = 0;
  private static readonly OFFLINE_RESET_MS = 30_000;

  private async fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
    if (this.useOfflineFallback && Date.now() - this.offlineFallbackSetAt > LlmApiClient.OFFLINE_RESET_MS) {
      this.useOfflineFallback = false;
    }
    if (this.useOfflineFallback) {
      throw new Error('API unavailable');
    }

    await waitForAuth();
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          ...options.headers,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let body: { error?: string; message?: string; retryable?: boolean; retry_after?: number } | null = null;
        try {
          body = text ? (JSON.parse(text) as typeof body) : null;
        } catch {
          body = null;
        }
        const retryable = body?.retryable ?? (res.status === 429 || res.status >= 500);
        const message = body?.error || body?.message || text || res.statusText;
        const headerRetryAfter = Number(res.headers?.get('retry-after'));
        const retryAfterSeconds = body?.retry_after ?? (Number.isFinite(headerRetryAfter) ? headerRetryAfter : undefined);
        throw new ApiClientError(
          `API ${res.status}: ${message}`,
          res.status,
          retryable,
          retryAfterSeconds && retryAfterSeconds > 0 ? Math.ceil(retryAfterSeconds * 1000) : undefined,
        );
      }
      return res;
    } catch (err: any) {
      if (err instanceof TypeError && String(err.message || '').includes('fetch')) {
        this.useOfflineFallback = true;
        this.offlineFallbackSetAt = Date.now();
      }
      throw err;
    }
  }

  async generateText(params: GenerateTextParams): Promise<string> {
    const preferredProvider =
      params.provider ||
      (import.meta.env.VITE_LLM_PROVIDER as 'openrouter' | 'gemini' | undefined) ||
      'openrouter';

    const makeReq = async (provider: 'openrouter' | 'gemini', model?: string) =>
      this.fetchWithAuth(params.onStream ? '/v1/llm/generate/stream' : '/v1/llm/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: params.prompt,
          model: model || params.model,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          history: params.history,
          provider,
          responseSchema: params.responseSchema,
          requestType: params.requestType || 'user',
          metrics: params.metrics,
        }),
      });

    try {
      const res = await makeReq(preferredProvider);
      if (params.onStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let raw = '';
        let emittedText = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          raw += chunk;
          if (params.responseSchema) {
            const startMatch = /"text"\s*:\s*"/.exec(raw);
            if (startMatch?.index !== undefined) {
              const start = startMatch.index + startMatch[0].length;
              let end = start;
              let escaped = false;
              for (; end < raw.length; end += 1) {
                const char = raw[end];
                if (char === '"' && !escaped) break;
                escaped = char === '\\' && !escaped;
                if (char !== '\\') escaped = false;
              }
              try {
                const decoded = JSON.parse(`"${raw.slice(start, end)}"`) as string;
                const delta = decoded.slice(emittedText.length);
                if (delta) params.onStream(delta);
                emittedText = decoded;
              } catch {
                // Wait for the remainder of an escape sequence in the next chunk.
              }
            }
          } else {
            params.onStream(chunk);
          }
        }
        return raw;
      }
      const data = await res.json() as { text?: string; provider?: 'openrouter' | 'gemini'; model?: string };
      params.onResponseMetadata?.({ provider: data.provider, model: data.model });
      return data?.text ?? '';
    } catch (err: any) {
      const msg = String(err?.message || '');
      const isConfigErr = /Server not configured for OpenRouter/i.test(msg);
      const isGeminiConfigErr = /Server not configured for Gemini/i.test(msg);
      const retryableProviderFailure = err instanceof ApiClientError && err.retryable;

      if (preferredProvider === 'openrouter' && (isConfigErr || retryableProviderFailure)) {
        const res = await makeReq('gemini');
        const data = await res.json() as { text?: string; provider?: 'openrouter' | 'gemini'; model?: string };
        params.onResponseMetadata?.({ provider: data.provider, model: data.model });
        return data?.text ?? '';
      }
      if (preferredProvider === 'gemini' && (isGeminiConfigErr || retryableProviderFailure)) {
        const res = await makeReq('openrouter');
        const data = await res.json() as { text?: string; provider?: 'openrouter' | 'gemini'; model?: string };
        params.onResponseMetadata?.({ provider: data.provider, model: data.model });
        return data?.text ?? '';
      }
      throw err;
    }
  }

  async generateImage(params: GenerateImageParams): Promise<string> {
    const res = await this.fetchWithAuth('/v1/images/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: params.prompt,
        model: params.model,
        referenceImages: params.referenceImages || (params.referenceImage ? [params.referenceImage] : undefined),
        quality: params.quality,
      }),
    });
    const data = await res.json();
    return data?.image ?? '';
  }

  async appendMessageImage(params: AppendMessageImageParams): Promise<void> {
    const maxAttempts = 5;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const res = await this.fetchWithAuth(
          `/v1/images/message/${encodeURIComponent(params.messageId)}/images`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              url: params.image.url,
              prompt: params.image.prompt,
              model: params.image.model,
              quality: params.image.quality,
            }),
          },
        );
        await res.json().catch(() => ({}));
        return;
      } catch (error) {
        lastError = error;
        const isNotFound = /API 404\b/.test(String((error as Error)?.message || error));
        if (!isNotFound || attempt === maxAttempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  async getImageQuotaStatus(): Promise<ImageQuotaStatus | null> {
    try {
      const res = await this.fetchWithAuth('/v1/images/quota');
      return await res.json();
    } catch {
      return null;
    }
  }

  async extractMemories(prompt: string, maxTokens = 1000): Promise<string> {
    try {
      const res = await this.fetchWithAuth('/v1/llm/extract', {
        method: 'POST',
        body: JSON.stringify({ prompt, maxTokens }),
      });
      const data = await res.json();
      return data?.text ?? '';
    } catch (error) {
      logger.warn('[LLMApiClient] Memory extraction failed', error);
      return '';
    }
  }
}

export const llmApiClient = new LlmApiClient();
