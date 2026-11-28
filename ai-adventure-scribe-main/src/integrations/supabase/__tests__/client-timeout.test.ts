/**
 * #1790: the shared Supabase client aborts a request that never answers.
 * A hung query used to inherit the browser's ~35 s TCP wait; the client now
 * carries a 30 s default timeout (SUPABASE_REQUEST_TIMEOUT_MS).
 */
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import {
  createTimeoutFetch,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from '../client';

// The client module under test imports createClient at module scope; capture
// what it was given so the wiring (not just the factory) is asserted.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ __mockSupabaseClient: true })),
}));

/**
 * A fetch that behaves like the real one on abort: it never settles on its
 * own, and rejects with the signal's reason when the signal aborts.
 */
const hangingFetch = (seen: { signal: AbortSignal | null }): typeof fetch => {
  const stub = vi.fn(
    (_input: unknown, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal ?? null;
      seen.signal = signal;
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return; // no signal: never settles, like a blackholed request
        if (signal.aborted) {
          reject(
            signal.reason ?? new DOMException('aborted', 'AbortError'),
          );
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            reject(
              signal.reason ?? new DOMException('aborted', 'AbortError'),
            );
          },
          { once: true },
        );
      });
    },
  );
  return stub as unknown as typeof fetch;
};

describe('Supabase request timeout (#1790)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // NB: no vi.clearAllMocks() here — the createClient call under test
    // happens once, at module import, and its history must survive across
    // tests in this file.
  });

  it('defaults to 30 s — below the ~35 s browser TCP wait', () => {
    expect(SUPABASE_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('wires the timeout fetch into createClient', () => {
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { global: { fetch: expect.any(Function) } },
    );
  });

  it('fails a hung request fast with a TimeoutError naming the timeout', async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal('fetch', hangingFetch(seen));

    const promise = createTimeoutFetch(50)('https://example.invalid/x');
    let caught: unknown = null;
    promise.catch((error: unknown) => {
      caught = error;
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe('TimeoutError');
    expect((caught as DOMException).message).toContain(
      'Supabase request timed out after 50 ms',
    );
    expect(seen.signal?.aborted).toBe(true);
  });

  it('uses the 30 s default when no timeout is given', async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal('fetch', hangingFetch(seen));

    const promise = createTimeoutFetch()('https://example.invalid/x');
    let caught: unknown = null;
    promise.catch((error: unknown) => {
      caught = error;
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(caught).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe('TimeoutError');
    expect((caught as DOMException).message).toContain('30000 ms');
  });

  it('passes a fast request through and clears the timer on settle', async () => {
    const response = { ok: true } as unknown as Response;
    const stub = vi.fn((_input: unknown, _init?: RequestInit) =>
      Promise.resolve(response),
    );
    vi.stubGlobal('fetch', stub as unknown as typeof fetch);

    const result = await createTimeoutFetch(50)(
      'https://example.invalid/x',
      { method: 'POST', headers: { 'x-test': '1' } },
    );

    expect(result).toBe(response);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub).toHaveBeenCalledWith(
      'https://example.invalid/x',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-test': '1' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a plain network error through and clears the timer', async () => {
    const networkError = new TypeError('Failed to fetch');
    const stub = vi.fn((_input: unknown, _init?: RequestInit) =>
      Promise.reject(networkError),
    );
    vi.stubGlobal('fetch', stub as unknown as typeof fetch);

    const promise = createTimeoutFetch(50)('https://example.invalid/x');
    let caught: unknown = null;
    promise.catch((error: unknown) => {
      caught = error;
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(caught).toBe(networkError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a request that finishes just before the deadline succeed', async () => {
    const response = { ok: true } as unknown as Response;
    const stub = vi.fn(
      (_input: unknown, init?: RequestInit): Promise<Response> =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          const timer = setTimeout(() => resolve(response), 49);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(
                signal.reason ?? new DOMException('aborted', 'AbortError'),
              );
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', stub as unknown as typeof fetch);

    const promise = createTimeoutFetch(50)('https://example.invalid/x');
    await vi.advanceTimersByTimeAsync(49);

    await expect(promise).resolves.toBe(response);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours the caller aborting mid-flight with the caller reason', async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal('fetch', hangingFetch(seen));
    const caller = new AbortController();
    const callerReason = new DOMException('caller gave up', 'AbortError');

    const promise = createTimeoutFetch(10_000)('https://example.invalid/x', {
      signal: caller.signal,
    });
    let caught: unknown = null;
    promise.catch((error: unknown) => {
      caught = error;
    });
    caller.abort(callerReason);
    await vi.advanceTimersByTimeAsync(0);

    expect(caught).toBe(callerReason);
    expect(seen.signal?.aborted).toBe(true);
  });

  it('honours a signal that is already aborted when the call starts', async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal('fetch', hangingFetch(seen));
    const caller = new AbortController();
    const callerReason = new DOMException('already gone', 'AbortError');
    caller.abort(callerReason);

    const promise = createTimeoutFetch(10_000)('https://example.invalid/x', {
      signal: caller.signal,
    });
    let caught: unknown = null;
    promise.catch((error: unknown) => {
      caught = error;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(caught).toBe(callerReason);
  });

  it('the fetch wired into createClient is the timeout fetch', async () => {
    const mockedCreateClient = vi.mocked(createClient);
    const wiredFetch = mockedCreateClient.mock.calls[0][2]?.global
      ?.fetch as typeof fetch | undefined;
    expect(typeof wiredFetch).toBe('function');

    const seen: { signal: AbortSignal | null } = { signal: null };
    vi.stubGlobal('fetch', hangingFetch(seen));

    const promise = (wiredFetch as typeof fetch)(
      'https://example.invalid/x',
    );
    let caught: unknown = null;
    promise.catch((error: unknown) => {
      caught = error;
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe('TimeoutError');
  });
});
