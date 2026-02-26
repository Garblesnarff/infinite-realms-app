import { waitForAuth } from '@/lib/auth-gate';
import { supabase } from '@/integrations/supabase/client';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

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
  /** 'user' for chat messages (counts against 30/day), 'system' for background tasks like memory extraction (500/day) */
  requestType?: 'user' | 'system';
}

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  referenceImages?: string[]; // base64 images without data URL prefix
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
  private static readonly OFFLINE_RESET_MS = 30_000; // 30 seconds

  private async fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
    // Auto-reset offline fallback after 30 seconds
    if (
      this.useOfflineFallback &&
      Date.now() - this.offlineFallbackSetAt > LlmApiClient.OFFLINE_RESET_MS
    ) {
      this.useOfflineFallback = false;
    }

    if (this.useOfflineFallback) {
      throw new Error('API unavailable');
    }

    // Wait for auth verification to complete before making API calls
    // This prevents 401 errors from expired tokens during page load
    await waitForAuth();

    // Get WorkOS token from localStorage
    const token = window.localStorage.getItem('workos_access_token');

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...options.headers,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${text || res.statusText}`);
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
      this.fetchWithAuth('/v1/llm/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: params.prompt,
          model: model || params.model,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          history: params.history,
          provider,
          requestType: params.requestType || 'user', // Default to 'user' for backwards compatibility
        }),
      });

    try {
      const res = await makeReq(preferredProvider);
      const data = await res.json();
      return data?.text ?? '';
    } catch (err: any) {
      const msg = String(err?.message || '');
      const isConfigErr = /Server not configured for OpenRouter/i.test(msg);
      const isGeminiConfigErr = /Server not configured for Gemini/i.test(msg);
      const isRateLimitErr = /429|rate\s*limit|too\s*many\s*requests|quota\s*exceeded/i.test(msg);

      if (preferredProvider === 'openrouter' && isConfigErr) {
        const res = await makeReq('gemini');
        const data = await res.json();
        return data?.text ?? '';
      }
      if (preferredProvider === 'gemini' && isGeminiConfigErr) {
        const res = await makeReq('openrouter');
        const data = await res.json();
        return data?.text ?? '';
      }
      // Rate limit - try multiple free fallback models
      if (isRateLimitErr) {
        const fallbackModels = [
          'arcee-ai/trinity-large-preview:free', // First fallback (free)
          'stepfun/step-3.5-flash:free', // Second fallback (free)
          'nvidia/nemotron-3-nano-30b-a3b:free', // Third fallback (free)
        ];
        console.warn(`[LLMApiClient] ${preferredProvider} rate limited, trying fallback models`);

        for (const fallbackModel of fallbackModels) {
          try {
            console.info(`[LLMApiClient] Trying fallback: ${fallbackModel}`);
            const res = await makeReq('openrouter', fallbackModel);
            const data = await res.json();
            if (data?.text) {
              console.info(`[LLMApiClient] Fallback succeeded: ${fallbackModel}`);
              return data.text;
            }
          } catch (fallbackErr) {
            console.warn(`[LLMApiClient] Fallback ${fallbackModel} failed:`, fallbackErr);
            // Continue to next fallback
          }
        }
        console.error('[LLMApiClient] All fallback models failed');
        throw err; // Throw original error if all fallbacks fail
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
        referenceImages: params.referenceImages,
        quality: params.quality,
      }),
    });
    const data = await res.json();
    return data?.image ?? '';
  }

  async appendMessageImage(params: AppendMessageImageParams): Promise<void> {
    const maxRetries = 5;
    const initialDelay = 200; // Start at 200ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
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

        // Check if response is OK
        if (!res.ok) {
          const errorBody = await res.text();
          const is404 = res.status === 404;

          if (is404 && attempt < maxRetries - 1) {
            // Retry on 404 errors (message might not be committed yet)
            const delay = initialDelay * Math.pow(2, attempt); // 200ms, 400ms, 800ms, 1600ms, 3200ms
            console.warn(
              `[LLMApiClient] 404 on image attachment, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`,
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue; // Retry
          }

          // Non-404 error or final retry attempt - throw
          throw new Error(`API ${res.status}: ${errorBody}`);
        }

        // Success
        await res.json().catch(() => ({}));
        if (attempt > 0) {
          console.log(
            `[LLMApiClient] ✅ Image attachment succeeded on retry attempt ${attempt + 1}`,
          );
        }
        return;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          // Final attempt failed
          throw error;
        }
        // Otherwise continue to next retry
      }
    }
  }

  async getImageQuotaStatus(): Promise<ImageQuotaStatus | null> {
    try {
      const res = await this.fetchWithAuth('/v1/images/quota');
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Extract memories from conversation using dedicated extraction endpoint.
   * Uses free model (DeepSeek V3.1 Nex-N1) with paid fallback (ByteDance Seed 1.6 Flash).
   * @param prompt - The extraction prompt containing conversation context
   * @param maxTokens - Max tokens for response (default 1000)
   * @returns The extracted text (JSON string with memories)
   */
  async extractMemories(prompt: string, maxTokens: number = 1000): Promise<string> {
    try {
      const res = await this.fetchWithAuth('/v1/llm/extract', {
        method: 'POST',
        body: JSON.stringify({ prompt, maxTokens }),
      });
      const data = await res.json();
      return data?.text ?? '';
    } catch (err) {
      console.warn('[LLMApiClient] Memory extraction failed:', err);
      return '';
    }
  }
}

export const llmApiClient = new LlmApiClient();
