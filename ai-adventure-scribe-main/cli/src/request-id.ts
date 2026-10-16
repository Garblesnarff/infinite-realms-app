/**
 * Capture the `x-request-id` the server echoed on the most recent response.
 *
 * The play client calls `fetch` through many layers, so rather than thread the
 * id through every call site we wrap the global `fetch` once. Each wrapped
 * target is recorded so repeated installs do not stack wrappers.
 */
type FetchLike = (...args: Parameters<typeof fetch>) => Promise<Response>;
type FetchTarget = { fetch: FetchLike };

let lastRequestId: string | undefined;
const wrappedTargets = new WeakSet<object>();

export function installRequestIdCapture(target: FetchTarget = globalThis): void {
  if (wrappedTargets.has(target)) return;
  wrappedTargets.add(target);
  const original = target.fetch;
  target.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await original(...args);
    const requestId = response.headers.get('x-request-id');
    if (requestId) lastRequestId = requestId;
    return response;
  };
}

export function getLastRequestId(): string | undefined {
  return lastRequestId;
}
