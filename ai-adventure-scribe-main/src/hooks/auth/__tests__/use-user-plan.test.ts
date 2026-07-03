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
    global.fetch = vi.fn();

    vi.stubEnv('VITE_API_URL', apiUrl);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return null plan by default when no user is provided', async () => {
    const { result } = renderHook(() => useUserPlan({ user: null, loading: false }));

    expect(result.current.userPlan).toBeNull();
  });

  it('should return null plan when no token is found in localStorage', async () => {
    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBeNull();
    });
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

  it('should default to free plan on fetch error', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any).mockResolvedValue({
      ok: false,
    });

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBe('free');
    });
  });

  it('should default to free plan on network exception', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBe('free');
    });
  });

  it('should not fetch plan while auth is loading', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: true }));

    expect(result.current.userPlan).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should return early when offline', async () => {
    window.localStorage.setItem('workos_access_token', mockToken);
    (isOffline as any).mockReturnValue(true);

    const { result } = renderHook(() => useUserPlan({ user: mockUser, loading: false }));

    await waitFor(() => {
      expect(result.current.userPlan).toBeNull();
    });
    expect(global.fetch).not.toHaveBeenCalled();
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
});
