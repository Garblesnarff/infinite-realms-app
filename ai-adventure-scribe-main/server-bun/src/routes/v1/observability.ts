/**
 * Observability Routes for Elysia
 *
 * Provides frontend error and metric logging endpoints:
 * - POST /v1/observability/error - Log frontend errors
 * - POST /v1/observability/metric - Log frontend metrics
 *
 * These endpoints are intentionally unauthenticated so guest/pre-login users can
 * report errors and metrics. Security is enforced via aggressive per-IP rate limiting
 * (20 errors/min, 50 metrics/min) to prevent log poisoning.
 *
 * Ported from /server/src/routes/v1/observability.ts
 */

import { Elysia } from 'elysia';

import { logger } from '../../lib/logger.js';
import { createSimpleRateLimit } from '../../middleware/rate-limit.js';

// Aggressive rate limiting to prevent log poisoning attacks
const errorRateLimit = createSimpleRateLimit({
  windowMs: 60_000, // 1 minute
  max: 20, // Max 20 errors per minute per IP
  key: 'observability:error',
});

const metricRateLimit = createSimpleRateLimit({
  windowMs: 60_000, // 1 minute
  max: 50, // Max 50 metrics per minute per IP
  key: 'observability:metric',
});

export const observabilityRoutes = new Elysia({ prefix: '/v1/observability' })

  /**
   * POST /v1/observability/error
   * Log frontend errors with sanitization
   */
  .use(errorRateLimit)
  .post('/error', ({ body, request }) => {
    const rid = request.headers.get('x-request-id') || 'unknown';
    const { message, stack, extra } = body as { message?: string; stack?: string; extra?: unknown };

    // Sanitize and truncate error messages to prevent abuse
    const sanitizedMessage = typeof message === 'string' ? message.slice(0, 500) : 'No message';
    const sanitizedStack = typeof stack === 'string' ? stack.slice(0, 2000) : undefined;

    const payload = {
      level: 'error',
      msg: 'frontend.error',
      requestId: rid,
      error: { message: sanitizedMessage, stack: sanitizedStack },
      extra: extra && typeof extra === 'object' ? JSON.stringify(extra).slice(0, 500) : undefined,
    };
    logger.error(payload);

    return new Response(null, { status: 204 });
  })

  /**
   * POST /v1/observability/metric
   * Log frontend metrics with validation
   */
  .use(metricRateLimit)
  .post('/metric', ({ body, request, set }) => {
    const rid = request.headers.get('x-request-id') || 'unknown';
    const { name, value, tags } = body as { name?: string; value?: number; tags?: string[] };

    // Validate metric data
    if (typeof name !== 'string' || name.length > 100) {
      set.status = 400;
      return { error: 'Invalid metric name' };
    }

    const payload = {
      level: 'info',
      msg: 'frontend.metric',
      requestId: rid,
      metric: {
        name: name.slice(0, 100),
        value: typeof value === 'number' ? value : 0,
        tags: Array.isArray(tags) ? tags.slice(0, 10) : undefined,
      },
    };
    logger.info(payload);

    return new Response(null, { status: 204 });
  });
