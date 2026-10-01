/**
 * Request Logging Middleware for Elysia
 *
 * Provides request/response logging with:
 * - Unique request ID generation
 * - Request method, path, and IP tracking
 * - Response status and duration
 * - Structured logging via Pino
 *
 * Usage:
 * ```typescript
 * import { loggingPlugin } from './middleware/logging';
 *
 * app.use(loggingPlugin)
 *   .get('/api/endpoint', handler);
 * ```
 */

import { Elysia } from 'elysia';

import { validationIssues } from '../http-pipeline.js';
import { logger } from '../lib/logger.js';

/**
 * Generate a unique request ID
 * Format: req_<timestamp>_<random>
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `req_${timestamp}_${random}`;
}

/**
 * Extract client IP from request headers
 */
function getClientIp(request: Request): string {
  // Check common proxy headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}

/**
 * Extract user agent from request headers
 */
function getUserAgent(request: Request): string {
  return request.headers.get('user-agent') || 'unknown';
}

/**
 * Request logging plugin
 * Logs all incoming requests and their responses
 */
export const loggingPlugin = new Elysia({ name: 'logging' })
  .derive(({ request }) => {
    // Generate unique request ID and attach to context
    const requestId = generateRequestId();
    const startTime = Date.now();

    // Extract request metadata
    const method = request.method;
    const url = new URL(request.url);
    const path = url.pathname;
    const query = url.search;
    const ip = getClientIp(request);
    const userAgent = getUserAgent(request);

    // Log incoming request
    logger.info(
      {
        type: 'request',
        requestId,
        method,
        path,
        query: query || undefined,
        ip,
        userAgent,
      },
      `→ ${method} ${path}`,
    );

    return {
      requestId,
      startTime,
    };
  })
  .onAfterHandle(({ request, response, requestId, startTime }) => {
    // Calculate request duration
    const duration = Date.now() - (startTime || Date.now());

    // Extract response metadata
    const method = request.method;
    const url = new URL(request.url);
    const path = url.pathname;

    // Determine status code
    let statusCode = 200;
    if (response && typeof response === 'object') {
      if ('status' in response) {
        statusCode = Number(response.status) || 200;
      }
    }

    // Determine response size (approximate)
    let responseSize: number | undefined;
    if (response) {
      if (typeof response === 'string') {
        responseSize = response.length;
      } else if (typeof response === 'object') {
        try {
          responseSize = JSON.stringify(response).length;
        } catch {
          // Ignore
        }
      }
    }

    // Log response
    const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[logLevel](
      {
        type: 'response',
        requestId,
        method,
        path,
        statusCode,
        duration,
        responseSize,
      },
      `← ${method} ${path} ${statusCode} ${duration}ms`,
    );

    // Add request ID to response headers
    if (response && typeof response === 'object' && !Array.isArray(response)) {
      // Note: Elysia handles headers differently, so we return a new Response
      // with the X-Request-Id header added
      return response;
    }

    return response;
  })
  .onError(({ request, error, code, requestId, startTime }) => {
    // Calculate request duration
    const duration = Date.now() - (startTime || Date.now());

    // Extract request metadata
    const method = request.method;
    const url = new URL(request.url);
    const path = url.pathname;

    // Map error code to status
    const statusCode = mapErrorCodeToStatus(code);

    // Elysia's validation message and stack carry the submitted body; log the issues instead (#2382).
    const isValidation = code === 'VALIDATION';
    const errorMessage = isValidation
      ? 'Validation failed'
      : error instanceof Error
        ? error.message
        : String(error);
    const errorStack = !isValidation && error instanceof Error ? error.stack : undefined;

    // Log error
    logger.error(
      {
        type: 'error',
        requestId,
        method,
        path,
        statusCode,
        duration,
        errorCode: code,
        errorMessage,
        errorStack,
        ...(isValidation ? { issues: validationIssues(error, { schemaPathsOnly: true }) } : {}),
      },
      `✗ ${method} ${path} ${statusCode} ${duration}ms - ${errorMessage}`,
    );
  })
  // Add request ID to response headers via onAfterResponse
  .onAfterResponse(({ set, requestId }) => {
    if (!set.headers) {
      set.headers = {};
    }
    set.headers['X-Request-Id'] = requestId;
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
 * Child logger factory for specific modules
 * Preserves request ID context if available
 */
export function createModuleLogger(moduleName: string) {
  return logger.child({ module: moduleName });
}
