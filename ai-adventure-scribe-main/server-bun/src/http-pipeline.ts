import { randomUUID } from 'crypto';

import { Elysia } from 'elysia';

import { logger } from './lib/logger.js';
import { httpRequestCounter, httpRequestDuration } from './lib/metrics.js';

/**
 * Global request lifecycle shared by the production app and HTTP contract tests.
 * This layer observes responses only; it never changes a successful body or
 * applies authentication after a handler has run.
 */
/**
 * One id per request, derived once and reused by every hook.
 *
 * Each hook used to derive its own: `onRequest` and `derive` each called
 * `randomUUID()` independently, while `onAfterHandle` and `onError` fell back
 * to the literal string 'unknown' when the client sent no header. That is why
 * `request.end` lines routinely logged `requestId: "unknown"` and could not be
 * joined to their own `request.start`. (#2050 D)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveRequestId(request: Request, store: any): string {
  if (!store.__requestId) {
    store.__requestId = request.headers.get('x-request-id') || randomUUID();
  }
  return store.__requestId as string;
}

export function createRequestPipelineApp() {
  return new Elysia()
    .derive(({ request, store }) => {
      return { requestId: resolveRequestId(request, store) };
    })
    .onRequest(({ request, store }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).__startTime = performance.now();

      const requestId = resolveRequestId(request, store);
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
      const requestId = resolveRequestId(request, store);
      // Hand the id back so a client-side failure can be joined to this log line
      // instead of matched by timestamp. (#2050 D)
      set.headers['x-request-id'] = requestId;

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
    .onError(({ error, request, set, code, store }) => {
      const requestId = resolveRequestId(request, store);
      set.headers['x-request-id'] = requestId;

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
