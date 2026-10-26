import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('TokenService localStorage lease fallback for refresh lock', () => {
  let originalLocksDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers();

    originalLocksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalLocksDescriptor) {
      Object.defineProperty(navigator, 'locks', originalLocksDescriptor);
    } else {
      Reflect.deleteProperty(navigator, 'locks');
    }
  });

  it('waits while another owner holds a live lease and calls fetch once after lease key is cleared', async () => {
    const LEASE_KEY = 'aas_workos_token_refresh_lease';
    const now = Date.now();
    localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: 'other-tab', expiresAt: now + 10000 }));

    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as Promise<Response>,
    );

    vi.resetModules();
    const { refreshAccessToken } = await import('../TokenService');

    const refreshPromise = refreshAccessToken('fake-refresh-1', 'fake-access-1');

    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();

    localStorage.removeItem(LEASE_KEY);

    await vi.advanceTimersByTimeAsync(90);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: true,
      json: async () => ({ accessToken: 'new-access-1', refreshToken: 'new-refresh-1' }),
    } as Response);

    const result = await refreshPromise;
    expect(result).toEqual({ accessToken: 'new-access-1', refreshToken: 'new-refresh-1' });
  });

  it('reclaims a stale lease with expiresAt in the past and calls fetch without waiting', async () => {
    const LEASE_KEY = 'aas_workos_token_refresh_lease';
    const now = Date.now();
    localStorage.setItem(
      LEASE_KEY,
      JSON.stringify({ owner: 'stale-owner', expiresAt: now - 1000 }),
    );

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'new-access-2', refreshToken: 'new-refresh-2' }),
    } as Response);

    vi.resetModules();
    const { refreshAccessToken } = await import('../TokenService');

    const refreshPromise = refreshAccessToken('fake-refresh-2', 'fake-access-2');

    await vi.advanceTimersByTimeAsync(40);
    const result = await refreshPromise;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ accessToken: 'new-access-2', refreshToken: 'new-refresh-2' });
  });

  it('rechecks ownership after an interleaved contender write before refreshing', async () => {
    const LEASE_KEY = 'aas_workos_token_refresh_lease';
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: 'new-access-interleaved',
        refreshToken: 'new-refresh-interleaved',
      }),
    } as Response);

    vi.resetModules();
    const { refreshAccessToken } = await import('../TokenService');
    const refreshPromise = refreshAccessToken(
      'fake-refresh-interleaved',
      'fake-access-interleaved',
    );

    // A second tab wins the storage race during the settle window.
    localStorage.setItem(
      LEASE_KEY,
      JSON.stringify({ owner: 'other-tab', expiresAt: Date.now() + 10000 }),
    );
    await vi.advanceTimersByTimeAsync(40);
    expect(fetchMock).not.toHaveBeenCalled();

    localStorage.removeItem(LEASE_KEY);
    await vi.advanceTimersByTimeAsync(90);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(refreshPromise).resolves.toEqual({
      accessToken: 'new-access-interleaved',
      refreshToken: 'new-refresh-interleaved',
    });
  });

  it('renews the stored lease expiresAt while the refresh fetch is pending', async () => {
    const LEASE_KEY = 'aas_workos_token_refresh_lease';

    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }) as Promise<Response>,
    );

    vi.resetModules();
    const { refreshAccessToken } = await import('../TokenService');

    const refreshPromise = refreshAccessToken('fake-refresh-3', 'fake-access-3');

    await vi.advanceTimersByTimeAsync(40);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const initialLeaseRaw = localStorage.getItem(LEASE_KEY);
    expect(initialLeaseRaw).not.toBeNull();
    const initialLease = JSON.parse(initialLeaseRaw!) as { owner: string; expiresAt: number };

    await vi.advanceTimersByTimeAsync(3500);

    const renewedLeaseRaw = localStorage.getItem(LEASE_KEY);
    expect(renewedLeaseRaw).not.toBeNull();
    const renewedLease = JSON.parse(renewedLeaseRaw!) as { owner: string; expiresAt: number };

    expect(renewedLease.owner).toBe(initialLease.owner);
    expect(renewedLease.expiresAt).toBeGreaterThan(initialLease.expiresAt);

    resolveFetch({
      ok: true,
      json: async () => ({ accessToken: 'new-access-3', refreshToken: 'new-refresh-3' }),
    } as Response);

    await refreshPromise;
  });

  it('removes the lease key after refresh finishes when fetch resolves with a good pair', async () => {
    const LEASE_KEY = 'aas_workos_token_refresh_lease';

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'new-access-4', refreshToken: 'new-refresh-4' }),
    } as Response);

    vi.resetModules();
    const { refreshAccessToken } = await import('../TokenService');

    const refreshPromise = refreshAccessToken('fake-refresh-4', 'fake-access-4');
    await vi.advanceTimersByTimeAsync(40);
    const result = await refreshPromise;
    expect(result).toEqual({ accessToken: 'new-access-4', refreshToken: 'new-refresh-4' });
    expect(localStorage.getItem(LEASE_KEY)).toBeNull();
  });

  it('removes the lease key after refresh finishes when fetch rejects', async () => {
    const LEASE_KEY = 'aas_workos_token_refresh_lease';

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValue(new Error('Network error'));

    vi.resetModules();
    const { refreshAccessToken } = await import('../TokenService');

    const refreshPromise = refreshAccessToken('fake-refresh-5', 'fake-access-5');
    await vi.advanceTimersByTimeAsync(40);
    const result = await refreshPromise;
    expect(result).toBeNull();
    expect(localStorage.getItem(LEASE_KEY)).toBeNull();
  });
});
