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
 * Per-request state, keyed on the Request object itself.
 *
 * This previously lived on Elysia's `store`, which is the APPLICATION store --
 * one object shared by every request for the life of the process, not
 * per-request state. The id was memoized there with `if (!store.__requestId)`,
 * so the first request after boot set it and nothing ever replaced it: after
 * #2051 deployed, 933 request lines carried 3 distinct ids, one per restart,
 * and every `x-request-id` response header was a constant. `__startTime` had
 * the same flaw in a different shape -- overwritten on each request, so under
 * concurrency one request's duration was measured from another's start.
 *
 * A WeakMap keyed on the Request gives one entry per request and lets the
 * entry be collected with the request. It relies on Elysia handing the SAME
 * Request instance to onRequest / derive / onAfterHandle / onError; the
 * concurrency test in `http-pipeline-request-id.test.ts` asserts exactly that,
 * rather than assuming it. (#2050 D)
 */
const requestIds = new WeakMap<Request, string>();
const startTimes = new WeakMap<Request, number>();

function resolveRequestId(request: Request): string {
  let id = requestIds.get(request);
  if (!id) {
    id = request.headers.get('x-request-id') || randomUUID();
    requestIds.set(request, id);
  }
  return id;
}

export function createRequestPipelineApp() {
  return new Elysia()
    .derive(({ request }) => {
      return { requestId: resolveRequestId(request) };
    })
    .onRequest(({ request }) => {
      startTimes.set(request, performance.now());

      const requestId = resolveRequestId(request);
      logger.info({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        msg: 'request.start',
      });
    })
    .onAfterHandle(({ request, response, set }) => {
      const start = startTimes.get(request) ?? performance.now();
      const durationMs = performance.now() - start;
      const url = new URL(request.url);
      const status = set.status || (response instanceof Response ? response.status : 200);
      const requestId = resolveRequestId(request);
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
    .onError(({ error, request, set, code }) => {
      const requestId = resolveRequestId(request);
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
