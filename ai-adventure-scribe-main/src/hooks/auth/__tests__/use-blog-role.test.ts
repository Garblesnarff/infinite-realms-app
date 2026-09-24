/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useBlogRole } from '../use-blog-role';

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

describe('useBlogRole', () => {
  const mockUser = { id: 'user-123', email: 'test@example.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    (isOffline as any).mockReturnValue(false);

    // Production: DEV is unset, and neither override var is set.
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('DEV', '');
    vi.stubEnv('VITE_DEV_BLOG_ADMIN_EMAIL', undefined);
    vi.stubEnv('VITE_BLOG_ADMIN_DEV_OVERRIDE', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return null role by default when no user is provided', async () => {
    const { result } = renderHook(() => useBlogRole({ user: null }));

    expect(result.current.blogRole).toBeNull();
    expect(result.current.isBlogAdmin).toBe(false);
  });

  it('should return admin if a valid blog admin token is in sessionStorage', async () => {
    const payload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      type: 'blog_admin',
      role: 'admin',
    };
    const token = `header.${btoa(JSON.stringify(payload))}.signature`;
    window.sessionStorage.setItem('blog_admin_token', token);

    const { result } = renderHook(() => useBlogRole({ user: null }));

    await waitFor(() => {
      expect(result.current.blogRole).toBe('admin');
      expect(result.current.isBlogAdmin).toBe(true);
    });
  });

  it('should remove invalid blog admin token and return null', async () => {
    window.sessionStorage.setItem('blog_admin_token', 'invalid-token');

    const { result } = renderHook(() => useBlogRole({ user: null }));

    await waitFor(() => {
      expect(result.current.blogRole).toBeNull();
    });

    expect(window.sessionStorage.getItem('blog_admin_token')).toBeNull();
  });

  it('should handle expired blog admin token', async () => {
    const payload = {
      exp: Math.floor(Date.now() / 1000) - 3600,
      type: 'blog_admin',
      role: 'admin',
    };
    const token = `header.${btoa(JSON.stringify(payload))}.signature`;
    window.sessionStorage.setItem('blog_admin_token', token);

    const { result } = renderHook(() => useBlogRole({ user: null }));

    await waitFor(() => {
      expect(result.current.blogRole).toBeNull();
    });
  });

  it('should grant admin in dev mode when override is enabled', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('DEV', 'true');
    vi.stubEnv('VITE_BLOG_ADMIN_DEV_OVERRIDE', 'true');

    const { result } = renderHook(() => useBlogRole({ user: mockUser }));

    await waitFor(() => {
      expect(result.current.blogRole).toBe('admin');
    });
  });

  it('should grant admin in dev mode when email matches VITE_DEV_BLOG_ADMIN_EMAIL', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('DEV', 'true');
    vi.stubEnv('VITE_DEV_BLOG_ADMIN_EMAIL', 'test@example.com');
    vi.stubEnv('VITE_BLOG_ADMIN_DEV_OVERRIDE', 'false');

    const { result } = renderHook(() => useBlogRole({ user: mockUser }));

    await waitFor(() => {
      expect(result.current.blogRole).toBe('admin');
    });
  });

  it('returns null for a signed-in user in production when no override vars are set', async () => {
    const { result } = renderHook(() => useBlogRole({ user: mockUser }));

    await act(async () => {
      await result.current.refreshBlogRole();
    });

    expect(result.current.blogRole).toBeNull();
    expect(result.current.isBlogAdmin).toBe(false);
  });

  it('should return null when offline', async () => {
    (isOffline as any).mockReturnValue(true);

    const { result } = renderHook(() => useBlogRole({ user: mockUser }));

    await waitFor(() => {
      expect(result.current.blogRole).toBeNull();
    });
  });

  it('should clear blog role when user logs out', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('DEV', 'true');
    vi.stubEnv('VITE_BLOG_ADMIN_DEV_OVERRIDE', 'true');

    const { result, rerender } = renderHook(({ user }) => useBlogRole({ user }), {
      initialProps: { user: mockUser as any },
    });

    await waitFor(() => {
      expect(result.current.blogRole).toBe('admin');
    });

    rerender({ user: null });

    await waitFor(() => {
      expect(result.current.blogRole).toBeNull();
    });
  });

  it('should refresh role when storage event for blog_admin_token fires', async () => {
    const { result } = renderHook(() => useBlogRole({ user: null }));

    expect(result.current.blogRole).toBeNull();

    const payload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      type: 'blog_admin',
      role: 'admin',
    };
    const token = `header.${btoa(JSON.stringify(payload))}.signature`;
    window.sessionStorage.setItem('blog_admin_token', token);

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'blog_admin_token' }));
    });

    await waitFor(() => {
      expect(result.current.blogRole).toBe('admin');
    });
  });

  it('should allow manual refresh via refreshBlogRole', async () => {
    const { result } = renderHook(() => useBlogRole({ user: null }));

    const payload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      type: 'blog_admin',
      role: 'admin',
    };
    const token = `header.${btoa(JSON.stringify(payload))}.signature`;
    window.sessionStorage.setItem('blog_admin_token', token);

    await act(async () => {
      await result.current.refreshBlogRole();
    });

    expect(result.current.blogRole).toBe('admin');
  });
});
