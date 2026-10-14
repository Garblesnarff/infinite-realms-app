/**
 * Bounded waits for client HTTP requests (#565).
 *
 * A deploy swap can blackhole a connection instead of refusing it: the TCP
 * handshake stalls and fetch() never settles. Without a timeout the request —
 * and whatever UI state waits on it ("Loading...", "Saving Character...",
 * "Completing sign in...") — hangs forever with no error and no recovery.
 * Every request through the shared REST clients gets a ceiling; the abort surfaces
 * as an AbortError, which callers already treat as a failure (it is not
 * retried as a network error).
 */

/** Default ceiling for one request attempt through the shared API clients (#565). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface TimeoutHandle {
  /** AbortSignal that fires on timeout (or when the caller's signal aborts). */
  signal: AbortSignal;
  /** Clear the timer once the request settles. */
  done: () => void;
}

/**
 * Start a timeout that aborts the returned signal after `timeoutMs`. If the
 * caller passes its own signal, aborting that also aborts the returned signal
 * (so pipeline-level aborts, e.g. the DM turn's 90 s abort, keep working).
 * Always call `done()` when the request settles to clear the timer.
 */
export function startRequestTimeout(
  timeoutMs: number,
  callerSignal?: AbortSignal | null,
): TimeoutHandle {
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

/**
 * fetch() that rejects with an AbortError if the request does not settle
 * within `timeoutMs`. Honors a caller-provided signal in `init`. The abort is
 * raced (not just signaled) so even a fetch implementation that ignores the
 * signal cannot hang the caller past the deadline.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const { signal: callerSignal, ...rest } = init;
  const handle = startRequestTimeout(timeoutMs, callerSignal ?? null);
  const onTimeout = new Promise<never>((_, reject) => {
    if (handle.signal.aborted) {
      reject(new DOMException('The request was aborted.', 'AbortError'));
    } else {
      handle.signal.addEventListener(
        'abort',
        () => reject(new DOMException('The request was aborted.', 'AbortError')),
        { once: true },
      );
    }
  });
  try {
    return await Promise.race([fetch(input, { ...rest, signal: handle.signal }), onTimeout]);
  } finally {
    handle.done();
  }
}
