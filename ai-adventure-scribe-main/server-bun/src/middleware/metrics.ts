/**
 * Prometheus Metrics Middleware for Elysia
 *
 * Tracks HTTP request metrics for monitoring and observability:
 * - Request count by method, route, and status code
 * - Request duration histogram
 *
 * Usage:
 * ```typescript
 * import { metricsPlugin } from './middleware/metrics';
 *
 * app.use(metricsPlugin)
 *   .get('/api/endpoint', handler);
 * ```
 *
 * Metrics are exposed via the existing /metrics endpoint using the shared registry.
 */

import { Elysia } from 'elysia';

import { logger } from '../lib/logger.js';
import { httpRequestCounter, httpRequestDuration } from '../lib/metrics.js';

/**
 * Extract route pattern from request
 * Tries to get the route pattern for accurate labeling
 */
function getRoutePattern(request: Request, path?: string): string {
  // Use path parameter if provided (from Elysia context)
  if (path) {
    return path;
  }

  // Fallback to pathname
  const url = new URL(request.url);
  return url.pathname;
}

/**
 * Normalize route for metrics
 * Removes trailing slashes and handles edge cases
 */
function normalizeRoute(route: string): string {
  if (!route || route === '/') return '/';
  return route.endsWith('/') ? route.slice(0, -1) : route;
}

/**
 * Metrics collection plugin
 * Tracks request count and duration for all routes
 */
export const metricsPlugin = new Elysia({ name: 'metrics' })
  .onBeforeHandle({ as: 'scoped' }, ({ request: _request, store }) => {
    // Store start time for duration calculation
    (store as any).metricsStartTime = Date.now();
  })
  .onAfterHandle({ as: 'scoped' }, ({ request, response, store, path }) => {
    try {
      // Calculate duration
      const startTime = (store as any).metricsStartTime || Date.now();
      const duration = (Date.now() - startTime) / 1000; // Convert to seconds

      // Extract route and method
      const route = normalizeRoute(getRoutePattern(request, path));
      const method = request.method;

      // Determine status code from response
      let statusCode = 200;
      if (response && typeof response === 'object') {
        // Check if response has status property
        if ('status' in response) {
          statusCode = Number(response.status) || 200;
        }
      }

      // Record metrics
      httpRequestDuration.observe(
        { method, route, status: String(statusCode) },
        duration
      );

      httpRequestCounter.inc({
        method,
        route,
        status: String(statusCode),
      });

      logger.debug(`[Metrics] ${method} ${route} ${statusCode} ${duration.toFixed(3)}s`);
    } catch (error) {
      // Don't fail requests due to metrics errors
      logger.error({ error: error }, 'Metrics collection error:');
    }
  })
  .onError(({ request, error: _error, code, store, path }) => {
    try {
      // Calculate duration for error cases
      const startTime = (store as any).metricsStartTime || Date.now();
      const duration = (Date.now() - startTime) / 1000;

      // Extract route and method
      const route = normalizeRoute(getRoutePattern(request, path));
      const method = request.method;

      // Map Elysia error codes to HTTP status codes
      const statusCode = mapErrorCodeToStatus(code);

      // Record metrics for errors
      httpRequestDuration.observe(
        { method, route, status: String(statusCode) },
        duration
      );

      httpRequestCounter.inc({
        method,
        route,
        status: String(statusCode),
      });

      logger.debug(`[Metrics] ${method} ${route} ${statusCode} ${duration.toFixed(3)}s (error: ${code})`);
    } catch (metricsError) {
      // Don't fail requests due to metrics errors
      logger.error({ error: metricsError }, 'Metrics collection error in error handler:');
    }
  });

/**
 * Map Elysia error codes to HTTP status codes
 */
function mapErrorCodeToStatus(code: string | number): number {
  if (typeof code === 'number') return code;

  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
      return 400;
    case 'PARSE':
      return 400;
    case 'INTERNAL_SERVER_ERROR':
      return 500;
    case 'INVALID_COOKIE_SIGNATURE':
      return 401;
    case 'UNKNOWN':
      return 500;
    default:
      return 500;
  }
}

/**
 * Metrics endpoint plugin
 * Exposes Prometheus metrics at /metrics
 */
export const metricsEndpoint = new Elysia({ name: 'metrics-endpoint' })
  .get('/metrics', async () => {
    const { register } = await import('../lib/metrics.js');
    const metrics = await register.metrics();
    return new Response(metrics, {
      headers: {
        'Content-Type': register.contentType,
      },
    });
  });
