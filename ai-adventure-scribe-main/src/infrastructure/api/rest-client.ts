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
  responseSchema?: Record<string, unknown>;
  onStream?: (chunk: string) => void;
}

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  referenceImage?: string; // base64 without data URL prefix
  quality?: 'low' | 'medium' | 'high';
}

export interface AppendMessageImageParams {
  messageId: string;
  image: { url: string; prompt?: string; model?: string; quality?: 'low' | 'medium' | 'high' };
}

class LlmApiClient {
  private useOfflineFallback = false;

  private async fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
    if (this.useOfflineFallback) {
      throw new Error('API unavailable');
    }

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
      }
      throw err;
    }
  }

  async generateText(params: GenerateTextParams): Promise<string> {
    const preferredProvider =
      params.provider ||
      (import.meta.env.VITE_LLM_PROVIDER as 'openrouter' | 'gemini' | undefined) ||
      'openrouter';

    const makeReq = async (provider: 'openrouter' | 'gemini') =>
      this.fetchWithAuth(params.onStream ? '/v1/llm/generate/stream' : '/v1/llm/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: params.prompt,
          model: params.model,
          maxTokens: params.maxTokens,
          temperature: params.temperature,
          history: params.history,
          provider,
          responseSchema: params.responseSchema,
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
      const data = await res.json();
      return data?.text ?? '';
    } catch (err: any) {
      const msg = String(err?.message || '');
      const isConfigErr = /Server not configured for OpenRouter/i.test(msg);
      const isGeminiConfigErr = /Server not configured for Gemini/i.test(msg);

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
      throw err;
    }
  }

  async generateImage(params: GenerateImageParams): Promise<string> {
    const res = await this.fetchWithAuth('/v1/images/generate', {
      method: 'POST',
      body: JSON.stringify({
        prompt: params.prompt,
        model: params.model,
        referenceImage: params.referenceImage,
        quality: params.quality,
      }),
    });
    const data = await res.json();
    return data?.image ?? '';
  }

  async appendMessageImage(params: AppendMessageImageParams): Promise<void> {
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
  }
}

export const llmApiClient = new LlmApiClient();
