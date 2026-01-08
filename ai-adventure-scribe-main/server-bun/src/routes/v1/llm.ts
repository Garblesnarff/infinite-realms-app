/**
 * LLM Routes for Elysia
 *
 * Provides LLM generation API endpoints:
 * - GET /v1/llm/quota - Get current quota status
 * - POST /v1/llm/generate - Generate text via OpenRouter or Gemini
 *
 * Ported from /server/src/routes/v1/llm.ts
 */

import { Elysia, t } from 'elysia';
import { authenticateRequest, type AuthUser } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService, type UsageType } from '../../services/ai-usage-service.js';
import { getCircuitBreaker, CircuitOpenError } from '../../utils/circuit-breaker.js';
import { logger } from '../../lib/logger.js';

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

const GEMINI_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
let geminiModelCache: { ids: Set<string>; fetchedAt: number } | null = null;

/**
 * Check if error indicates model is unavailable
 */
const isModelUnavailableError = (status: number, message: string) => {
  if (status === 404) return true;
  if (status === 400) {
    return /model\s+(id\s+)?['"]?[^'"\s]+['"]?\s+is\s+not\s+valid/i.test(message)
      || /unsupported\s+model/i.test(message)
      || /could\s+not\s+be\s+resolved/i.test(message);
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
 * Deduplicate model list
 */
const dedupeModels = (values: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
};

/**
 * Build list of model candidates to try
 */
const buildModelCandidates = (preferred: string, variants: string[], fallback: string) => {
  const extras: string[] = [];
  if (/^gemini-2\.5-flash-lite$/i.test(preferred)) {
    extras.push('gemini-2.5-flash-lite-001', 'gemini-2.5-flash-lite-preview');
  }
  return dedupeModels([preferred, ...variants, ...extras, fallback]);
};

/**
 * Get available Gemini model IDs (cached)
 */
const getGeminiModelIds = async (apiKey: string): Promise<Set<string>> => {
  const now = Date.now();
  if (geminiModelCache && (now - geminiModelCache.fetchedAt) < GEMINI_MODEL_CACHE_TTL_MS) {
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

      const resp = await fetch(url.toString());
      if (!resp.ok) break;
      const data = await resp.json() as { models?: Array<{ name?: string }>; nextPageToken?: string };
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

export const llmRoutes = new Elysia({ prefix: '/v1/llm' })

  /**
   * Get current quota status
   * GET /v1/llm/quota
   */
  .get('/quota', async ({ request, set }) => {
    // Direct auth check - bypasses Elysia plugin context issues
    const { user, error } = await authenticateRequest(request);
    if (error || !user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    try {
      const quotaStatus = await AIUsageService.getQuotaStatus({
        userId: user.userId,
        plan: user.plan,
        type: 'llm',
      });
      return quotaStatus;
    } catch (err) {
      logger.error({ msg: 'LLM_QUOTA_ERROR', error: err });
      set.status = 500;
      return { error: 'Failed to fetch quota status' };
    }
  })

  /**
   * Generate text via LLM
   * POST /v1/llm/generate
   */
  .post(
    '/generate',
    async ({ request, body, set }) => {
      // Direct auth check - bypasses Elysia plugin context issues
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      const {
        prompt,
        model,
        maxTokens = 1000,
        temperature = 0.8,
        history,
        provider = 'openrouter',
        requestType = 'user',
      } = body || {};

      if (!prompt || typeof prompt !== 'string') {
        set.status = 400;
        return { error: 'Missing prompt' };
      }

      const userId = user.userId;
      const plan = user.plan;

      // Quota check
      const quotaType: UsageType = requestType === 'system' ? 'llm_system' : 'llm';
      const quota = await AIUsageService.checkQuotaAndConsume({ userId, plan, type: quotaType, units: 1 });
      if (!quota.allowed) {
        set.status = 402;
        set.headers['Retry-After'] = String(Math.max(1, Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1000)));
        return { error: 'AI quota exceeded', remaining: quota.remaining, resetAt: quota.resetAt };
      }

      try {
        // OpenRouter provider
        if (provider === 'openrouter') {
          const breaker = getCircuitBreaker('llm:openrouter');
          try {
            breaker.allowOrThrow();
          } catch (e) {
            if (e instanceof CircuitOpenError) {
              set.status = 503;
              set.headers['Retry-After'] = String(Math.max(1, e.retryAfterSec));
              return { error: 'Provider temporarily unavailable' };
            }
            throw e;
          }

          const apiKey = process.env.OPENROUTER_API_KEY;
          if (!apiKey) {
            set.status = 500;
            return { error: 'Server not configured for OpenRouter' };
          }

          const textModel = model || process.env.OPENROUTER_TEXT_MODEL || 'nvidia/nemotron-3-nano-30b-a3b:free';
          const messages: ChatMessage[] = [];

          if (Array.isArray(history)) {
            for (const m of history) {
              if (m && m.role && typeof m.content === 'string') messages.push(m);
            }
          }
          messages.push({ role: 'user', content: prompt });

          const reqBody = {
            model: textModel,
            messages,
            max_tokens: maxTokens,
            temperature,
          };

          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.APP_ORIGIN || 'http://localhost:5173',
              'X-Title': 'AI Adventure Scribe',
            },
            body: JSON.stringify(reqBody),
          });

          if (!response.ok) {
            const errText = await response.text();
            const status = response.status;
            logger.error({ msg: 'LLM_OPENROUTER_ERROR', status, errText });
            breaker.onFailure();
            set.status = status;
            return { error: 'LLM request failed', details: errText };
          }

          breaker.onSuccess();
          type ORChatResp = { choices?: { message?: { content?: string } }[] };
          const data = (await response.json()) as ORChatResp;
          const text: string = data.choices?.[0]?.message?.content ?? '';
          return { text };
        }

        // Gemini provider
        if (provider === 'gemini') {
          const breaker = getCircuitBreaker('llm:gemini');
          try {
            breaker.allowOrThrow();
          } catch (e) {
            if (e instanceof CircuitOpenError) {
              set.status = 503;
              set.headers['Retry-After'] = String(Math.max(1, e.retryAfterSec));
              return { error: 'Provider temporarily unavailable' };
            }
            throw e;
          }

          const apiKey = process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
          if (!apiKey) {
            set.status = 500;
            return { error: 'Server not configured for Gemini' };
          }

          const preferredModel = (typeof model === 'string' && model.trim())
            ? model.trim()
            : (process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash-lite');
          const fallbackModel = (process.env.GEMINI_TEXT_FALLBACK || 'gemini-2.0-flash-lite').trim() || 'gemini-2.0-flash-lite';
          const variantEnv = (process.env.GEMINI_MODEL_VARIANTS || '')
            .split(',')
            .map(v => v.trim())
            .filter(Boolean);
          const candidateModels = buildModelCandidates(preferredModel, variantEnv, fallbackModel);

          const toGeminiRole = (role: ChatMessage['role']): 'user' | 'model' => {
            if (role === 'assistant') return 'model';
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
              }
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
                logger.warn({ msg: 'LLM_GEMINI_MODEL_UNAVAILABLE', candidate, available: Array.from(availableModels).join(', ') });
              } else {
                logger.warn({ msg: 'LLM_GEMINI_MODEL_REJECTED', candidate, errText });
              }
              continue;
            }

            logger.warn({ msg: 'LLM_GEMINI_REQUEST_FAILED', candidate, status: response.status, errText });
          }

          if (!successPayload || !successModel) {
            breaker.onFailure();
            const status = lastFailure?.status ?? 400;
            const details = lastFailure?.details || `All Gemini model attempts failed. Tried: ${attempts.join(', ')}`;
            set.status = status;
            return { error: 'LLM request failed', details, attempts };
          }

          if (successModel !== preferredModel) {
            logger.warn({ msg: 'LLM_GEMINI_FALLBACK', requested: preferredModel, using: successModel, attempts: attempts.join(', ') });
          }

          breaker.onSuccess();
          const data = successPayload as any;
          const candidates = data?.candidates || [];
          const first = candidates[0];
          const parts: Array<{ text?: string }> = first?.content?.parts || [];
          const text = parts.map(p => p?.text).filter(Boolean).join('\n');
          return { text: text || '' };
        }

        set.status = 400;
        return { error: 'Unsupported provider' };
      } catch (e) {
        logger.error({ msg: 'LLM_ERROR', error: e });
        if (e instanceof CircuitOpenError) {
          set.status = 503;
          set.headers['Retry-After'] = String(Math.max(1, e.retryAfterSec));
          return { error: 'Provider temporarily unavailable' };
        }
        set.status = 500;
        return { error: 'LLM request failed' };
      }
    },
    {
      body: t.Object({
        prompt: t.String(),
        model: t.Optional(t.String()),
        maxTokens: t.Optional(t.Number()),
        temperature: t.Optional(t.Number()),
        history: t.Optional(t.Array(t.Object({
          role: t.Union([t.Literal('user'), t.Literal('assistant'), t.Literal('system')]),
          content: t.String(),
        }))),
        provider: t.Optional(t.Union([t.Literal('openrouter'), t.Literal('gemini')])),
        requestType: t.Optional(t.Union([t.Literal('user'), t.Literal('system')])),
      }),
    }
  );
