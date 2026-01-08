import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { OpenAI } from 'openai';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService } from '../../services/ai-usage-service.js';
import { getCircuitBreaker, CircuitOpenError } from '../../utils/circuit-breaker.js';

/**
 * DEPRECATED: This route is in the deprecated Express server.
 * Use server-bun/src/routes/v1/llm.ts instead.
 *
 * This has been migrated from direct OpenAI/Anthropic to OpenRouter.
 */
export default function aiRouter() {
  const router = Router();
  router.use(requireAuth);
  router.use(planRateLimit('llm'));

  // Use OpenRouter as unified provider (OpenAI SDK with custom baseURL)
  const openrouter = process.env.OPENROUTER_API_KEY
    ? new OpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
      })
    : null;

  router.post('/respond', async (req: Request, res: Response) => {
    const { provider, messages, systemPrompt } = req.body as {
      provider?: 'openai' | 'anthropic';
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
      systemPrompt?: string;
    };

    // Quota check
    const userId = (req as any).user?.userId as string;
    const plan = (req as any).user?.plan as string || 'free';
    const quota = await AIUsageService.checkQuotaAndConsume({ userId, plan, type: 'llm', units: 1 });
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1000))));
      return res.status(402).json({ error: 'AI quota exceeded', remaining: quota.remaining, resetAt: quota.resetAt });
    }

    if (!openrouter) {
      return res.status(400).json({ error: 'OpenRouter API key not configured' });
    }

    const breaker = getCircuitBreaker('llm:openrouter');
    try {
      breaker.allowOrThrow();
    } catch (e) {
      if (e instanceof CircuitOpenError) {
        res.setHeader('Retry-After', String(Math.max(1, e.retryAfterSec)));
        return res.status(503).json({ error: 'Provider temporarily unavailable' });
      }
      throw e;
    }

    try {
      // Map provider preference to OpenRouter model
      // anthropic -> Claude via OpenRouter, openai -> Gemini via OpenRouter
      const model = provider === 'anthropic'
        ? 'anthropic/claude-3-5-sonnet'
        : process.env.OPENROUTER_TEXT_MODEL || 'nvidia/nemotron-3-nano-30b-a3b:free';

      const completion = await openrouter.chat.completions.create({
        model,
        messages: [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          ...messages,
        ],
        temperature: 0.9,
        max_tokens: 1024,
      });
      breaker.onSuccess();
      const text = completion.choices[0]?.message?.content || '';
      return res.json({ response: text });
    } catch (e) {
      breaker.onFailure();
      console.error('AI error', e);
      return res.status(500).json({ error: 'AI request failed' });
    }
  });

  return router;
}

