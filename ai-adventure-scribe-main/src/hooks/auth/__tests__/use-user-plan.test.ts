/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useUserPlan } from '../use-user-plan';

import { isOffline } from '@/utils/network';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock network
vi.mock('@/utils/network', () => ({
  isOffline: vi.fn(),
}));

describe('useUserPlan', () => {
  const mockUser = { id: 'user-123', email: 'test@example.com' };
  const mockToken = 'mock-access-token';
  const apiUrl = 'https://api.test.com';

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    (isOffline as any).mockReturnValue(false);

    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());

    vi.stubEnv('VITE_API_URL', apiUrl);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return null plan by default when no user is provided', async () => {
    const { result } = renderHook(() => useUserPlan({ user: null, loading: false }));

    expect(result.current.userPlan).toBeNull();
  });

  it('reports the error and retries when no token is found in localStorage (#351)', async () => {
    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    // No token means the server is unreachable: never invent "Free Tier".
    await waitFor(() => {
      expect(result.current.userPlan).toBeNull();
      expect(result.current.userPlanError).toBe(true);
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fetch user plan successfully', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ plan: 'pro' }),
    });

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBe('pro');
    });

    // We don't check exact URL here because of Vitest/import.meta.env quirk
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/llm/quota'),
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${mockToken}`,
          'Content-Type': 'application/json',
        },
      }),
    );
  });

  it('should handle missing VITE_API_URL', async () => {
    vi.stubEnv('VITE_API_URL', undefined);
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ plan: 'pro' }),
    });

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBe('pro');
    });

    expect(global.fetch).toHaveBeenCalledWith(`/v1/llm/quota`, expect.any(Object));
  });

  it('keeps the last known plan on fetch error instead of downgrading to free (#351)', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plan: 'tester' }),
      })
      .mockResolvedValueOnce({
        ok: false,
      });

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBe('tester');
    });

    await act(async () => {
      await result.current.refreshUserPlan();
    });

    // The failed fetch must not paint "Free Tier": the known plan stays.
    expect(result.current.userPlan).toBe('tester');
    expect(result.current.userPlanError).toBe(true);
  });

  it('reports the error without inventing a plan on network exception (#351)', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlanError).toBe(true);
    });
    expect(result.current.userPlan).toBeNull();
  });

  it('retries a failed fetch with backoff (#351)', async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem('workos_access_token', mockToken);
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      renderHook(() => useUserPlan({ user: mockUser, loading: false }));

      // The initial fetch fails…
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // …the first retry fires after ~1s, the second ~2s after that…
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(global.fetch).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(global.fetch).toHaveBeenCalledTimes(3);

      // …and the third waits ~4s, so 3s is not enough.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the error when a later fetch succeeds (#351)', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'pro' }) });

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlanError).toBe(true);
    });

    await act(async () => {
      await result.current.refreshUserPlan();
    });

    expect(result.current.userPlan).toBe('pro');
    expect(result.current.userPlanError).toBe(false);
  });

  it('should not fetch plan while auth is loading', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: true }));

    expect(result.current.userPlan).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports the error and retries when offline (#351)', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (isOffline as any).mockReturnValue(true);

    const { result, unmount } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    // Offline is a fetch failure, not a free plan: error surfaces, the plan
    // stays unknown, and no request goes out.
    await waitFor(() => {
      expect(result.current.userPlanError).toBe(true);
    });
    expect(result.current.userPlan).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();

    // The backoff retry fires and recovers once the network is back.
    (isOffline as any).mockReturnValue(false);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ plan: 'tester' }),
    });
    await waitFor(
      () => {
        expect(result.current.userPlan).toBe('tester');
      },
      { timeout: 5000 },
    );
    expect(result.current.userPlanError).toBe(false);
    unmount();
  });

  it('keeps the last known plan when the network drops after a success (#351)', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ plan: 'tester' }),
    });

    const { result, unmount } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBe('tester');
    });

    // The network drops; the next refresh must not downgrade the label.
    (isOffline as any).mockReturnValue(true);
    await act(async () => {
      await result.current.refreshUserPlan();
    });

    expect(result.current.userPlan).toBe('tester');
    expect(result.current.userPlanError).toBe(true);
    unmount();
  });

  it('should allow manual refresh via refreshUserPlan', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plan: 'free' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ plan: 'pro' }),
      });

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBe('free');
    });

    await act(async () => {
      await result.current.refreshUserPlan();
    });

    expect(result.current.userPlan).toBe('pro');
  });

  it('should clear plan when user logs out', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ plan: 'pro' }),
    });

    const { result, rerender } = renderHook(({ user }) => useUserPlan({ user, loading: false }), {
      initialProps: { user: mockUser as any },
    });

    await waitFor(() => {
      expect(result.current.userPlan).toBe('pro');
    });

    rerender({ user: null });

    expect(result.current.userPlan).toBeNull();
  });
  it('clears the previous account plan when a different account signs in (#2292)', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    let resolveSecond: (value: unknown) => void = () => {};
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: 'pro' }) })
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));

    const { result, rerender } = renderHook(({ user }) => useUserPlan({ user, loading: false }), {
      initialProps: { user: mockUser as any },
    });
    await waitFor(() => expect(result.current.userPlan).toBe('pro'));

    rerender({ user: { id: 'user-456', email: 'free@example.com' } });
    expect(result.current.userPlan).toBeNull();

    await act(async () => {
      resolveSecond({ ok: true, json: async () => ({ plan: 'free' }) });
    });
    expect(result.current.userPlan).toBe('free');
  });

  it('ignores a plan response that lands after sign-out (#2292)', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    let resolveFetch: (value: unknown) => void = () => {};
    (global.fetch as any).mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));

    const { result, rerender } = renderHook(({ user }) => useUserPlan({ user, loading: false }), {
      initialProps: { user: mockUser as any },
    });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    rerender({ user: null });
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ plan: 'pro' }) });
    });

    expect(result.current.userPlan).toBeNull();
  });
});
