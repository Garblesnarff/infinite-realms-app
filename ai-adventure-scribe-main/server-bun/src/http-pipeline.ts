import { randomUUID } from 'crypto';

import { Elysia } from 'elysia';

import { logger } from './lib/logger.js';
import { httpRequestCounter, httpRequestDuration } from './lib/metrics.js';
import { QuotaUnavailableError } from './lib/quota-errors.js';

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
const detachDisconnectListeners = new WeakMap<Request, () => void>();
const dmTurnRequests = new WeakMap<
  Request,
  { sessionId: string | null; provider: string | null; model: string | null }
>();
const dmTurnTimingLogged = new WeakSet<Request>();
const DM_GENERATE_ROUTE = '/v1/llm/generate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function captureDmTurnRequest(request: Request): Promise<void> {
  if (request.method !== 'POST' || new URL(request.url).pathname !== DM_GENERATE_ROUTE) return;

  try {
    const body = (await request.clone().json()) as unknown;
    if (!isRecord(body) || !isRecord(body.dmReply)) return;
    dmTurnRequests.set(request, {
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
      provider: typeof body.provider === 'string' ? body.provider : null,
      model: typeof body.model === 'string' ? body.model : null,
    });
  } catch {
    // The route's validation/error log owns malformed request details.
  }
}

function dmTurnOutcome(status: number, response: unknown): string {
  if (status === 402) return 'quota_exceeded';
  if (status >= 400) return 'error';
  return isRecord(response) && response.degraded === true ? 'degraded' : 'success';
}

function logDmTurnTiming(
  request: Request,
  status: number,
  response: unknown,
  durationMs: number,
): void {
  const requestDetails = dmTurnRequests.get(request);
  if (!requestDetails || dmTurnTimingLogged.has(request)) return;

  dmTurnTimingLogged.add(request);
  const responseRecord = isRecord(response) ? response : {};
  logger.info({
    msg: 'DM_TURN_TIMING',
    sessionId: requestDetails.sessionId,
    durationMs: Math.round(durationMs),
    provider:
      typeof responseRecord.provider === 'string'
        ? responseRecord.provider
        : requestDetails.provider,
    model: typeof responseRecord.model === 'string' ? responseRecord.model : requestDetails.model,
    outcome: dmTurnOutcome(status, response),
  });
}

/**
 * Log when the client goes away before the response is sent (#2148).
 *
 * #2144 could not tell a client abort from a slow success: the browser gave up on
 * /v1/llm/extract at 10 s, the server carried on and logged a 200 at 13–44 s, and nothing on
 * the server side said the caller had already left. Bun aborts `request.signal` when the
 * connection closes, so one listener per request answers that. It is detached once the response
 * has gone out, so a normal close after a finished response is never reported as a disconnect.
 */
function watchForClientDisconnect(request: Request): void {
  const signal = request.signal;
  if (!signal || signal.aborted) return;
  const onAbort = (): void => {
    detachDisconnectListeners.delete(request);
    const start = startTimes.get(request);
    logger.warn({
      requestId: resolveRequestId(request),
      method: request.method,
      url: new URL(request.url).pathname,
      elapsedMs: start === undefined ? undefined : Math.round(performance.now() - start),
      msg: 'request.client_disconnected',
    });
  };
  signal.addEventListener('abort', onAbort, { once: true });
  detachDisconnectListeners.set(request, () => signal.removeEventListener('abort', onAbort));
}

function stopWatchingForClientDisconnect(request: Request): void {
  detachDisconnectListeners.get(request)?.();
  detachDisconnectListeners.delete(request);
}

function resolveRequestId(request: Request): string {
  let id = requestIds.get(request);
  if (!id) {
    id = request.headers.get('x-request-id') || randomUUID();
    requestIds.set(request, id);
  }
  return id;
}

type SchemaNode = Record<string, unknown>;

const isNode = (value: unknown): value is SchemaNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One path segment down a TypeBox schema, or null when the node does not declare it. */
const declaredChild = (node: SchemaNode, segment: string): SchemaNode | null => {
  const properties = node.properties;
  if (isNode(properties) && Object.hasOwn(properties, segment) && isNode(properties[segment])) {
    return properties[segment];
  }
  if (isNode(node.items) && /^\d+$/.test(segment)) return node.items;
  for (const key of ['anyOf', 'allOf', 'oneOf']) {
    const branches = node[key];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      const child = isNode(branch) ? declaredChild(branch, segment) : null;
      if (child) return child;
    }
  }
  return null;
};

/** The schema every client-chosen key of a record (`t.Record`, `additionalProperties`) maps to. */
const recordValueSchema = (node: SchemaNode): SchemaNode | null => {
  const patterns = node.patternProperties;
  const value = isNode(patterns) ? Object.values(patterns)[0] : node.additionalProperties;
  return isNode(value) ? value : null;
};

/**
 * The failing instance path rewritten as a schema path: a segment the schema declares stays,
 * a segment the client chose (a `t.Record` key, an `additionalProperties` name) becomes `*`.
 * Without the schema nothing can be told apart, so every segment is `*`.
 */
function schemaPath(root: unknown, instancePath: string): string {
  let node: SchemaNode | null = isNode(root) ? root : null;
  const segments = instancePath.split('/').slice(1);
  return segments
    .map((segment) => {
      const child = node ? declaredChild(node, segment) : null;
      if (child) {
        node = child;
        return segment;
      }
      node = node ? recordValueSchema(node) : null;
      return '*';
    })
    .map((segment) => `/${segment}`)
    .join('');
}

/**
 * Field paths and rule messages of a validation failure, without the values that failed.
 * `schemaPathsOnly` is for log lines: record keys the client chose are not written there.
 */
export function validationIssues(
  error: unknown,
  { schemaPathsOnly = false }: { schemaPathsOnly?: boolean } = {},
): Array<{ path: string; message: string }> {
  const all = (error as { all?: unknown }).all;
  if (!Array.isArray(all)) return [];
  const root = (error as { validator?: { schema?: unknown } }).validator?.schema;
  return all.slice(0, 5).map((issue) => {
    const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown };
    const instancePath = typeof path === 'string' ? path : '';
    return {
      path: schemaPathsOnly ? schemaPath(root, instancePath) : instancePath,
      message: typeof message === 'string' ? message : 'invalid',
    };
  });
}

/**
 * Security headers for every response (#225). Shared by the app's
 * onBeforeHandle (normal routes) and the pipeline's onError (404s and thrown
 * errors, which never reach onBeforeHandle — and a later onError would never
 * run, because this onError always returns a response). CSP violations show
 * only in the browser console for now (no report-uri; the strategist will
 * file a report collector as a follow-up).
 */
export function setSecurityHeaders({
  set,
}: {
  set: { headers: Record<string, string | number> };
}): void {
  // Prevent MIME type sniffing
  set.headers['X-Content-Type-Options'] = 'nosniff';

  // Prevent clickjacking
  set.headers['X-Frame-Options'] = 'DENY';

  // XSS protection (legacy but still useful)
  set.headers['X-XSS-Protection'] = '1; mode=block';

  // Referrer policy for privacy
  set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';

  // Content Security Policy - report-only first (#225)
  set.headers['Content-Security-Policy-Report-Only'] = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'none'",
  ].join('; ');

  // HTTPS enforcement (Strict Transport Security)
  // Only set in production to avoid issues with local development
  if (process.env.NODE_ENV === 'production') {
    set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  }

  // Permissions policy (restrict browser features)
  set.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()';

  // LLM documentation discovery headers (llms.txt standard)
  set.headers['Link'] = '</llms.txt>; rel="llms-txt", </llms-full.txt>; rel="llms-full-txt"';
  set.headers['X-Llms-Txt'] = '/llms.txt';
}

export function createRequestPipelineApp() {
  return new Elysia()
    .derive(({ request }) => {
      return { requestId: resolveRequestId(request) };
    })
    .onRequest(async ({ request }) => {
      startTimes.set(request, performance.now());

      const requestId = resolveRequestId(request);
      logger.info({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        msg: 'request.start',
      });
      watchForClientDisconnect(request);
      await captureDmTurnRequest(request);
    })
    .onAfterResponse(({ request }) => {
      stopWatchingForClientDisconnect(request);
    })
    .onAfterHandle(({ request, response, set }) => {
      const start = startTimes.get(request) ?? performance.now();
      const durationMs = performance.now() - start;
      const url = new URL(request.url);
      const status =
        typeof set.status === 'number'
          ? set.status
          : response instanceof Response
            ? response.status
            : 200;
      const requestId = resolveRequestId(request);
      logDmTurnTiming(request, status, response, durationMs);
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
      // Error responses skip onBeforeHandle, so set the security headers here;
      // this onError always returns, which is why the app registers no later
      // onError for them (#225).
      setSecurityHeaders({ set });
      const quotaUnavailable = error instanceof QuotaUnavailableError;
      const status =
        code === 'VALIDATION' ? 422 : code === 'NOT_FOUND' ? 404 : quotaUnavailable ? 503 : 500;
      logDmTurnTiming(
        request,
        status,
        null,
        performance.now() - (startTimes.get(request) ?? performance.now()),
      );

      // Elysia's ValidationError.message is a JSON document that holds the submitted body
      // (`found`), and `stack` starts with that message. A validation failure logs the error kind
      // and the issues (path + rule, no values) instead, so player text never reaches the log (#2382).
      logger.error({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        ...(code === 'VALIDATION'
          ? {
              error: 'Validation failed',
              errorName: 'ValidationError',
              issues: validationIssues(error, { schemaPathsOnly: true }),
            }
          : {
              error: error instanceof Error ? error.message : String(error),
              errorName: error instanceof Error ? error.name : 'UnknownError',
              stack: error instanceof Error ? error.stack : undefined,
            }),
        msg: 'request.error',
      });

      if (code === 'VALIDATION') {
        // A 422 used to say "Internal Server Error", which hid run 11's real cause (a DM row
        // with empty text failing `minLength: 1`) behind a server-fault label (#2280). Name the
        // rule and the field. The submitted values are never echoed back.
        set.status = 422;
        return { error: 'Validation failed', issues: validationIssues(error) };
      }

      if (quotaUnavailable) {
        // The usage DB is down, so the quota cannot be checked. Refuse the call (#2673).
        set.status = 503;
        return { error: 'AI quota unavailable' };
      }

      set.status = code === 'NOT_FOUND' ? 404 : 500;
      return {
        error: code === 'NOT_FOUND' ? 'Not Found' : 'Internal Server Error',
        message:
          process.env.NODE_ENV === 'production'
            ? undefined
            : error instanceof Error
              ? error.message
              : String(error),
      };
    });
}
