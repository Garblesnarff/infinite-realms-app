import { llmApiClient, type GenerateTextParams } from '@/services/llm-api-client';
import logger from '@/lib/logger';

type GeminiHistoryEntry = { role: 'user' | 'assistant' | 'system'; content: string };

export interface RateLimitStats {
  dailyUsage: number;
  dailyLimit: number;
  recentRequests: number;
  minutelyLimit: number;
  remainingDaily: number;
  remainingMinutely: number;
  resetTime: number;
}

export class GeminiApiManager {
  private googleClientCtorPromise: Promise<any | null> | null = null;
  private directModeDisabled = false;

  private isDevelopment(): boolean {
    return import.meta.env.DEV || import.meta.env.MODE === 'development';
  }

  constructor() {
    const hasKeys = Boolean(
      import.meta.env.VITE_GEMINI_API_KEYS || import.meta.env.VITE_GOOGLE_GEMINI_API_KEY,
    );
    const allowDirect = this.isDirectModeOptIn();
    this.directModeDisabled = !allowDirect;

    if (this.isDevelopment()) {
      const mode = hasKeys && allowDirect ? 'direct Gemini mode' : 'server-proxy mode';
      logger.info(`GeminiApiManager initialized (${mode})`);
    }
  }

  private isDirectModeOptIn(): boolean {
    const flag = String(import.meta.env.VITE_GEMINI_DIRECT ?? '')
      .trim()
      .toLowerCase();
    if (!flag) return false;
    return flag === 'true' || flag === '1' || flag === 'yes' || flag === 'on';
  }

  private isAuthenticationError(error: unknown): boolean {
    if (!error) return false;
    const message = typeof error === 'string' ? error : (error as Error)?.message || '';

    if (!message) return false;

    return /api\s*key\s*not\s*valid|api_key_invalid|invalid\s*api\s*key|401|403/i.test(message);
  }

  private async loadGoogleGenerativeAI(): Promise<any | null> {
    if (!this.googleClientCtorPromise) {
      this.googleClientCtorPromise = import('@google/generative-ai')
        .then((mod) => mod?.GoogleGenerativeAI ?? null)
        .catch((error) => {
          logger.warn('[GeminiApiManager] Failed to load @google/generative-ai:', error);
          return null;
        });
    }
    return this.googleClientCtorPromise;
  }

  private buildPromptFromInput(input: any): { prompt: string; history?: GeminiHistoryEntry[] } {
    if (typeof input === 'string') return { prompt: input };

    if (input && Array.isArray(input.contents)) {
      const parts = input.contents as Array<{ role?: string; parts?: Array<{ text?: string }> }>;
      const texts: string[] = [];
      let history: GeminiHistoryEntry[] = [];

      for (const item of parts) {
        const t = (item.parts || [])
          .map((p) => p?.text)
          .filter((v): v is string => !!v)
          .join('\n');
        if (t) {
          const role = (item as any).role as string | undefined;
          if (
            role &&
            (role === 'user' || role === 'model' || role === 'assistant' || role === 'system')
          ) {
            history.push({ role: role === 'model' ? 'assistant' : (role as any), content: t });
          } else {
            texts.push(t);
          }
        }
      }

      let prompt = texts.join('\n\n');

      // If prompt is empty but we have history, use the last user message as prompt
      if (!prompt && history.length > 0) {
        const lastUserIndex = [...history].reverse().findIndex(h => h.role === 'user');
        if (lastUserIndex >= 0) {
          const actualIndex = history.length - 1 - lastUserIndex;
          prompt = history[actualIndex].content;
          history = [...history.slice(0, actualIndex), ...history.slice(actualIndex + 1)];
        }
      }

      return { prompt, history };
    }

    try {
      return { prompt: JSON.stringify(input) };
    } catch {
      return { prompt: String(input) };
    }
  }

  private toGeminiContents(prompt: string, history?: GeminiHistoryEntry[]) {
    const convertRole = (role: GeminiHistoryEntry['role']) => {
      if (role === 'assistant') return 'model';
      if (role === 'system') return 'user';
      return role;
    };

    const contents = (history || []).map((entry) => ({
      role: convertRole(entry.role),
      parts: [{ text: entry.content }],
    }));

    contents.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    return contents;
  }

  private selectApiVersion(model: string): 'v1' | 'v1beta' {
    if (/^gemini-2\.5-/i.test(model)) return 'v1';
    return 'v1beta';
  }

  private buildEndpoint(model: string, apiKey: string): string {
    const version = this.selectApiVersion(model);
    const encodedModel = encodeURIComponent(model);
    return `https://generativelanguage.googleapis.com/${version}/models/${encodedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
  }

  private createRestGenAI(apiKey: string) {
    const buildPrompt = (input: any) => this.buildPromptFromInput(input);

    const callText = async (
      model: string,
      prompt: string,
      history: GeminiHistoryEntry[] | undefined,
      config: Record<string, any> = {},
    ) => {
      const contents = this.toGeminiContents(prompt, history);
      const body: Record<string, any> = {
        contents,
      };
      if (config && Object.keys(config).length > 0) {
        body.generationConfig = config;
      }

      const response = await fetch(this.buildEndpoint(model, apiKey), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini REST error ${response.status}: ${errorText}`);
      }

      const json = await response.json();
      const candidates = json?.candidates || [];
      const firstCandidate = candidates[0];
      const parts: Array<{ text?: string }> = firstCandidate?.content?.parts || [];
      const text = parts
        .map((part) => part?.text)
        .filter(Boolean)
        .join('\n');
      return text || '';
    };

    return {
      getGenerativeModel: ({
        model,
        generationConfig,
      }: {
        model: string;
        generationConfig?: any;
      }) => {
        const defaultMax = generationConfig?.maxOutputTokens ?? generationConfig?.maxTokens ?? 1000;
        const defaultTemp = generationConfig?.temperature ?? 0.7;
        const defaultTopP = generationConfig?.topP;
        const defaultTopK = generationConfig?.topK;

        const buildConfig = (overrides?: {
          maxTokens?: number;
          temperature?: number;
          topK?: number;
          topP?: number;
        }) => {
          const cfg: Record<string, any> = {};
          const maxTokens = overrides?.maxTokens ?? defaultMax;
          const temperature = overrides?.temperature ?? defaultTemp;
          const topP = overrides?.topP ?? defaultTopP;
          const topK = overrides?.topK ?? defaultTopK;
          if (typeof maxTokens === 'number') cfg.maxOutputTokens = maxTokens;
          if (typeof temperature === 'number') cfg.temperature = temperature;
          if (typeof topP === 'number') cfg.topP = topP;
          if (typeof topK === 'number') cfg.topK = topK;
          return cfg;
        };

        return {
          async generateContent(input: any) {
            const { prompt, history } = buildPrompt(input);
            const text = await callText(
              model,
              prompt,
              history,
              buildConfig({
                maxTokens: generationConfig?.maxOutputTokens ?? generationConfig?.maxTokens,
                temperature: generationConfig?.temperature,
                topK: generationConfig?.topK,
                topP: generationConfig?.topP,
              }),
            );
            return { response: { text: () => text } } as any;
          },

          startChat({
            history,
            generationConfig: chatGen,
          }: {
            history?: any[];
            generationConfig?: any;
          }) {
            const hist: GeminiHistoryEntry[] = [];
            if (Array.isArray(history)) {
              for (const h of history) {
                const role = h.role === 'model' ? 'assistant' : h.role || 'user';
                const content = Array.isArray(h.parts)
                  ? h.parts
                      .map((p: any) => p?.text)
                      .filter(Boolean)
                      .join('\n') || ''
                  : String(h.content || '');
                if (content) hist.push({ role, content });
              }
            }

            const effConfig = buildConfig({
              maxTokens: chatGen?.maxOutputTokens ?? chatGen?.maxTokens,
              temperature: chatGen?.temperature,
              topK: chatGen?.topK,
              topP: chatGen?.topP,
            });

            return {
              async sendMessage(message: string) {
                const text = await callText(model, message, hist, effConfig);
                hist.push({ role: 'user', content: message });
                hist.push({ role: 'assistant', content: text });
                return { response: { text: () => text } } as any;
              },

              async sendMessageStream(message: string) {
                const text = await callText(model, message, hist, effConfig);
                hist.push({ role: 'user', content: message });
                hist.push({ role: 'assistant', content: text });
                const stream = {
                  async *[Symbol.asyncIterator]() {
                    yield { text: () => text } as any;
                  },
                } as any;
                return { stream } as any;
              },
            };
          },
        };
      },
    } as any;
  }

  private createGenAIStub() {
    const buildPrompt = (input: any) => this.buildPromptFromInput(input);
    return {
      getGenerativeModel({ model, generationConfig }: { model: string; generationConfig?: any }) {
        const defaultMax = generationConfig?.maxOutputTokens ?? generationConfig?.maxTokens ?? 1000;
        const defaultTemp = generationConfig?.temperature ?? 0.7;

        const callText = async (params: GenerateTextParams) => {
          return llmApiClient.generateText({
            ...params,
            model,
            maxTokens: params.maxTokens ?? defaultMax,
            temperature: params.temperature ?? defaultTemp,
            provider: 'gemini',
          });
        };

        return {
          async generateContent(input: any) {
            const { prompt, history } = buildPrompt(input);
            const text = await callText({ prompt, history });
            return { response: { text: () => text } } as any;
          },

          startChat({
            history,
            generationConfig: chatGen,
          }: {
            history?: any[];
            generationConfig?: any;
          }) {
            const hist: GeminiHistoryEntry[] = [];
            if (Array.isArray(history)) {
              for (const h of history) {
                const role = h.role === 'model' ? 'assistant' : h.role || 'user';
                const content = Array.isArray(h.parts)
                  ? h.parts
                      .map((p: any) => p?.text)
                      .filter(Boolean)
                      .join('\n') || ''
                  : String(h.content || '');
                if (content) hist.push({ role, content });
              }
            }

            const effMax = chatGen?.maxOutputTokens ?? defaultMax;
            const effTemp = chatGen?.temperature ?? defaultTemp;

            return {
              async sendMessage(message: string) {
                // If message is empty but there's history, extract a prompt from the last user entry
                let effectivePrompt = message;
                let effectiveHistory = hist;

                if (!effectivePrompt && hist.length > 0) {
                  // Find the last user message in history to use as the prompt
                  const lastUserIndex = hist.map(h => h.role).lastIndexOf('user');
                  if (lastUserIndex >= 0) {
                    effectivePrompt = hist[lastUserIndex].content;
                    effectiveHistory = hist.filter((_, i) => i !== lastUserIndex);
                  } else {
                    // No user message in history - use all history as context in prompt
                    effectivePrompt = hist.map(h => `[${h.role}]: ${h.content}`).join('\n\n');
                    effectiveHistory = [];
                  }
                }

                const text = await callText({
                  prompt: effectivePrompt,
                  history: effectiveHistory,
                  maxTokens: effMax,
                  temperature: effTemp,
                });
                return { response: { text: () => text } } as any;
              },

              async sendMessageStream(message: string) {
                // Same logic for streaming
                let effectivePrompt = message;
                let effectiveHistory = hist;

                if (!effectivePrompt && hist.length > 0) {
                  const lastUserIndex = hist.map(h => h.role).lastIndexOf('user');
                  if (lastUserIndex >= 0) {
                    effectivePrompt = hist[lastUserIndex].content;
                    effectiveHistory = hist.filter((_, i) => i !== lastUserIndex);
                  } else {
                    effectivePrompt = hist.map(h => `[${h.role}]: ${h.content}`).join('\n\n');
                    effectiveHistory = [];
                  }
                }

                const fullText = await callText({
                  prompt: effectivePrompt,
                  history: effectiveHistory,
                  maxTokens: effMax,
                  temperature: effTemp,
                });
                const stream = {
                  async *[Symbol.asyncIterator]() {
                    yield { text: () => fullText } as any;
                  },
                } as any;
                return { stream } as any;
              },
            };
          },
        };
      },
    } as GoogleGenerativeAI;
  }

  async executeWithRotation<T>(
    operation: (genAI: any) => Promise<T>,
    _maxRetries: number = 1,
  ): Promise<T> {
    const keysRaw =
      import.meta.env.VITE_GEMINI_API_KEYS || import.meta.env.VITE_GOOGLE_GEMINI_API_KEY;
    const keys = String(keysRaw || '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);

    if (!this.directModeDisabled && keys.length > 0) {
      const primaryKey = keys[0];
      const GoogleGenerativeAI = await this.loadGoogleGenerativeAI();
      try {
        if (GoogleGenerativeAI) {
          const genAI = new GoogleGenerativeAI(primaryKey);
          return await operation(genAI);
        }

        // Fallback to REST adapter if SDK not available
        const restClient = this.createRestGenAI(primaryKey);
        return await operation(restClient);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '');
        if (this.isAuthenticationError(error)) {
          this.directModeDisabled = true;
          logger.warn(
            '[GeminiApiManager] Direct mode disabled after authentication error, falling back to proxy',
          );
        } else if (
          error instanceof TypeError ||
          /failed to fetch|access-control-allow-origin|cors/i.test(message)
        ) {
          this.directModeDisabled = true;
          logger.warn(
            '[GeminiApiManager] Direct mode disabled after network/CORS failure, falling back to proxy',
          );
        } else if (
          /model\s+(id\s+)?['"]?[^'"\s]+['"]?\s+is\s+not\s+valid|unsupported\s+model/i.test(message)
        ) {
          this.directModeDisabled = true;
          logger.warn(
            '[GeminiApiManager] Direct mode disabled after model availability error, falling back to proxy',
          );
        } else if (
          /429|rate\s*limit|too\s*many\s*requests|quota\s*exceeded|resource\s*exhausted/i.test(message)
        ) {
          // Rate limit hit - fall back to OpenRouter free tier
          logger.warn(
            '[GeminiApiManager] Rate limit hit on direct Gemini API, falling back to OpenRouter proxy',
          );
          // Don't disable direct mode permanently - just fall through to proxy for this request
        } else {
          throw error;
        }
      }
    }

    const genAIStub = this.createGenAIStub();
    return operation(genAIStub);
  }

  getStats(): any[] {
    return [];
  }
  getRateLimitStats(): any {
    return {
      dailyUsage: 0,
      dailyLimit: 0,
      recentRequests: 0,
      minutelyLimit: 0,
      remainingDaily: 0,
      remainingMinutely: 0,
      resetTime: 0,
    };
  }
  getCurrentKeyInfo(): { index: number; truncatedKey: string; stats: any } {
    return { index: 0, truncatedKey: 'server-proxy', stats: undefined };
  }
}
