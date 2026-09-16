import logger from '@/lib/logger';

/**
 * Record the server's `x-request-id` for a response, and return it. (#2050 D)
 *
 * The server logs a `requestId` on every `request.start` / `request.end`, but
 * the client never saw it, so joining "the client failed at 17:56" to a server
 * log line was timestamp guesswork — see the #2049 read.
 *
 * Levels are deliberate. `/v1/llm` logs at **info on every response**: `debug`
 * is compiled out in production (`src/lib/logger.ts`), and the case this exists
 * for is #2049 attempt 1 — a 200 from `/generate` followed by a client-side
 * throw — which would otherwise leave no id in the console at all. It is one
 * line per turn, so there is no noise problem. Other routes (`/v1/combat`, which
 * can fire several times per turn) stay at debug on success and warn on failure.
 *
 * Returns the id so a caller can attach it to its own failure log.
 */
export function logServerRequestId(
  route: string,
  res: Response,
  durationMs?: number,
): string | null {
  // Never let observability break a request path: callers include mocked
  // responses in tests and any Response-like object at runtime, so a missing
  // `headers` must be a no-op rather than a throw.
  const requestId = res?.headers?.get?.('x-request-id') ?? null;
  if (!requestId) return null;

  const payload: Record<string, unknown> = { route, status: res.status, requestId };
  if (typeof durationMs === 'number') payload.durationMs = Math.round(durationMs);

  if (route.startsWith('/v1/llm')) {
    logger.info('[api] llm request', payload);
  } else if (!res.ok) {
    logger.warn('[api] request failed', payload);
  } else {
    logger.debug('[api] server request id', payload);
  }
  return requestId;
}
