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
import { logger } from '../../lib/logger.js';
import { isAdmin } from '../../middleware/admin.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService, type UsageType } from '../../services/ai-usage-service.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';

export const llmRoutes = new Elysia({ prefix: '/v1/llm' })
  .use(planRateLimit('llm'))

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
        requestType: rawRequestType = 'user',
        responseSchema,
      } = body || {};

      if (!prompt || typeof prompt !== 'string') {
        set.status = 400;
        return { error: 'Missing prompt' };
      }

      // 🛡️ Sentinel: Restrict 'system' requests to admins to prevent quota bypass.
      const isAdminUser = isAdmin(user as AuthUser);
      const requestType = (rawRequestType === 'system' && isAdminUser) ? 'system' : 'user';

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

      const result = await LLMProviderService.generate({
        prompt,
        model,
        maxTokens,
        temperature,
        history,
        provider,
        responseSchema,
      });

      if (result.error) {
        if (result.status) {
          set.status = result.status;
        }
        if (result.retryAfter) {
          set.headers['Retry-After'] = String(Math.max(1, result.retryAfter));
        }
        return {
          error: result.error,
          details: result.details,
          attempts: result.attempts
        };
      }

      if (result.usage && result.provider) {
        await AIUsageService.recordProviderUsage({
          userId, plan, type: quotaType, provider: result.provider, model: result.model,
          inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        });
      }

      return { text: result.text };
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
        responseSchema: t.Optional(t.Any()),
      }),
    }
  )

  .post(
    '/generate/stream',
    async ({ request, body, set }) => {
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }
      const {
        prompt, model, maxTokens = 1000, temperature = 0.8, history,
        provider = 'openrouter', responseSchema,
      } = body || {};
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId: user.userId, plan: user.plan, type: 'llm', units: 1,
      });
      if (!quota.allowed) {
        set.status = 402;
        return { error: 'AI quota exceeded', remaining: quota.remaining, resetAt: quota.resetAt };
      }
      try {
        const stream = await LLMProviderService.stream({
          prompt, model, maxTokens, temperature, history, provider, responseSchema,
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      } catch (error) {
        logger.error({ msg: 'LLM_STREAM_ERROR', error });
        set.status = 502;
        return { error: 'LLM stream failed' };
      }
    },
    {
      body: t.Object({
        prompt: t.String(), model: t.Optional(t.String()), maxTokens: t.Optional(t.Number()),
        temperature: t.Optional(t.Number()),
        history: t.Optional(t.Array(t.Object({
          role: t.Union([t.Literal('user'), t.Literal('assistant'), t.Literal('system')]),
          content: t.String(),
        }))),
        provider: t.Optional(t.Union([t.Literal('openrouter'), t.Literal('gemini')])),
        responseSchema: t.Optional(t.Any()),
      }),
    },
  )

  /**
   * Extract memories via LLM (uses free model with paid fallback)
   * POST /v1/llm/extract
   *
   * Uses OPENROUTER_EXTRACTION_MODEL (free) as primary,
   * falls back to OPENROUTER_EXTRACTION_FALLBACK_MODEL on error.
   */
  .post(
    '/extract',
    async ({ request, body, set }) => {
      // Direct auth check
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      const { prompt, maxTokens = 1000 } = body || {};

      if (!prompt || typeof prompt !== 'string') {
        set.status = 400;
        return { error: 'Missing prompt' };
      }

      // Use system quota for extraction (doesn't count against user's chat quota)
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId: user.userId,
        plan: user.plan,
        type: 'llm_system',
        units: 1,
      });
      if (!quota.allowed) {
        set.status = 402;
        return { error: 'AI quota exceeded', resetAt: quota.resetAt };
      }

      const result = await LLMProviderService.extract({
        prompt,
        maxTokens,
      });

      if (result.error) {
        if (result.status) {
          set.status = result.status;
        }
        return { error: result.error };
      }

      if (result.usage && result.provider) {
        await AIUsageService.recordProviderUsage({
          userId: user.userId, plan: user.plan, type: 'llm_system', provider: result.provider,
          model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
        });
      }

      return { text: result.text, model: result.model };
    },
    {
      body: t.Object({
        prompt: t.String(),
        maxTokens: t.Optional(t.Number()),
      }),
    }
  );
