import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  startRequestTimeout,
} from '../fetch-with-timeout';

describe('fetchWithTimeout (#565)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves with the response when the request settles in time', async () => {
    const res = new Response(JSON.stringify({ ok: true }), { status: 200 });
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(res);

    const request = fetchWithTimeout('https://example.test/v1/things', { method: 'GET' }, 5_000);
    await expect(request).resolves.toBe(res);
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      RequestInit,
    ];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it('rejects with an AbortError when the request hangs past the timeout', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // hangs

    const request = fetchWithTimeout('https://example.test/v1/things', {}, 5_000);
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('uses the 30 s default timeout', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // hangs

    const request = fetchWithTimeout('https://example.test/v1/things');
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS - 1);
    // Not settled yet — the promise must still be pending just before the deadline.
    let settled = false;
    void request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('does not abort after the request already settled', async () => {
    const res = new Response('ok', { status: 200 });
    let capturedSignal: AbortSignal | undefined;
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_input: unknown, init?: RequestInit) => {
        capturedSignal = init?.signal as AbortSignal | undefined;
        return Promise.resolve(res);
      },
    );

    await expect(fetchWithTimeout('https://example.test/v1/things', {}, 5_000)).resolves.toBe(
      res,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it('honors a caller-provided signal that aborts first', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // hangs
    const caller = new AbortController();

    const request = fetchWithTimeout(
      'https://example.test/v1/things',
      { signal: caller.signal },
      30_000,
    );
    const assertion = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort();
    await assertion;
  });
});

describe('startRequestTimeout (#565)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the signal at the deadline and cleans up on done()', () => {
    const handle = startRequestTimeout(1_000);
    expect(handle.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(handle.signal.aborted).toBe(true);
    handle.done();
  });

  it('propagates an already-aborted caller signal immediately', () => {
    const caller = new AbortController();
    caller.abort();
    const handle = startRequestTimeout(30_000, caller.signal);
    expect(handle.signal.aborted).toBe(true);
    handle.done();
  });
});
