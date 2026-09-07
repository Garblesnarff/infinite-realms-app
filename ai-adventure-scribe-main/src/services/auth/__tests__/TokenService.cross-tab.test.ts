import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('TokenService cross-tab refresh coordination', () => {
  let originalLocks: unknown;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());

    originalLocks = (navigator as Navigator & { locks?: unknown }).locks;
    let lockTail = Promise.resolve();
    const request = vi.fn(
      async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback();
        } finally {
          release();
        }
      },
    );

    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLocks === undefined) {
      Reflect.deleteProperty(navigator, 'locks');
    } else {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: originalLocks,
      });
    }
  });

  it('lets two simulated tabs complete one rotating-token exchange', async () => {
    localStorage.setItem(
      'aas_workos_cached_session',
      JSON.stringify({ access_token: 'old-access', refresh_token: 'old-refresh' }),
    );

    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as Promise<Response>,
    );

    vi.resetModules();
    const tabOne = await import('../TokenService');
    vi.resetModules();
    const tabTwo = await import('../TokenService');

    const first = tabOne.refreshAccessTokenOnce('old-refresh', 'old-access');
    const second = tabTwo.refreshAccessTokenOnce('old-refresh', 'old-access');

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      json: async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
    } as Response);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { accessToken: 'new-access', refreshToken: 'new-refresh' },
      { accessToken: 'new-access', refreshToken: 'new-refresh' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tabTwo.getAccessToken()).toBe('new-access');
  });
});
