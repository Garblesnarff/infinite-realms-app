import { randomUUID } from 'crypto';

import { Elysia } from 'elysia';

import { logger } from './lib/logger.js';
import { httpRequestCounter, httpRequestDuration } from './lib/metrics.js';

/**
 * Global request lifecycle shared by the production app and HTTP contract tests.
 * This layer observes responses only; it never changes a successful body or
 * applies authentication after a handler has run.
 */
export function createRequestPipelineApp() {
  return new Elysia()
    .derive(({ request }) => {
      const requestId = request.headers.get('x-request-id') || randomUUID();
      return { requestId };
    })
    .onRequest(({ request, store }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).__startTime = performance.now();

      const requestId = request.headers.get('x-request-id') || randomUUID();
      logger.info({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        msg: 'request.start',
      });
    })
    .onAfterHandle(({ request, response, store, set }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const start = (store as any).__startTime || performance.now();
      const durationMs = performance.now() - start;
      const url = new URL(request.url);
      const status = set.status || (response instanceof Response ? response.status : 200);
      const requestId = request.headers.get('x-request-id') || 'unknown';

      httpRequestCounter.inc({
        method: request.method,
        route: url.pathname,
        status: String(status),
      });

      httpRequestDuration.observe(
        {
          method: request.method,
          route: url.pathname,
          status: String(status),
        },
        durationMs / 1000,
      );

      logger.info({
        requestId,
        method: request.method,
        url: url.pathname,
        status,
        durationMs: Math.round(durationMs * 1000) / 1000,
        msg: 'request.end',
      });
    })
    .onError(({ error, request, set, code }) => {
      const requestId = request.headers.get('x-request-id') || 'unknown';

      logger.error({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
        msg: 'request.error',
      });

      set.status = code === 'NOT_FOUND' ? 404 : code === 'VALIDATION' ? 422 : 500;
      return {
        error: 'Internal Server Error',
        message:
          process.env.NODE_ENV === 'production'
            ? undefined
            : error instanceof Error
              ? error.message
              : String(error),
      };
    });
}
