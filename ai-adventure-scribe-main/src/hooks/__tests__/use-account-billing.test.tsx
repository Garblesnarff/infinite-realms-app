/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAccountBilling, ACCOUNT_UPGRADE_PRICE } from '../use-account-billing';

import { analytics } from '@/services/analytics';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useSearchParams: vi.fn(),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock analytics
vi.mock('@/services/analytics', () => ({
  analytics: {
    track: vi.fn(),
  },
}));

describe('useAccountBilling', () => {
  const refreshUserPlan = vi.fn();
  const mockSearchParams = new URLSearchParams();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    (useSearchParams as any).mockReturnValue([mockSearchParams]);

    // Mock localStorage
    const store: any = {};
    const localStorageMock = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, value) => { store[key] = value.toString(); }),
      clear: vi.fn(() => { for (const key in store) delete store[key]; }),
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true, configurable: true });

    // Mock window.location
    delete (window as any).location;
    window.location = { ...originalLocation, href: '' } as any;

    // Mock fetch
    global.fetch = vi.fn() as any;
  });

  afterEach(() => {
    window.location = originalLocation;
    mockSearchParams.delete('success');
    mockSearchParams.delete('canceled');
  });

  it('should handle success redirect param', () => {
    mockSearchParams.set('success', 'true');
    renderHook(() => useAccountBilling('free', refreshUserPlan));

    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Welcome to Legend tier'));
    expect(analytics.track).toHaveBeenCalledWith('checkout_completed', { source: 'stripe_redirect' });
    expect(refreshUserPlan).toHaveBeenCalled();
  });

  it('should handle canceled redirect param', () => {
    mockSearchParams.set('canceled', 'true');
    renderHook(() => useAccountBilling('free', refreshUserPlan));

    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('canceled'));
    expect(analytics.track).toHaveBeenCalledWith('checkout_canceled', { source: 'stripe_redirect' });
  });

  it('should fetch subscription and quota on mount', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    const mockSubscription = { plan: 'legend', status: 'active' };
    const mockQuota = { used: 5, limit: 100 };

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.endsWith('/v1/billing/subscription')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSubscription),
        });
      }
      if (url.endsWith('/v1/llm/quota')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockQuota),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await waitFor(() => {
      expect(result.current.subscription).toEqual(mockSubscription);
      expect(result.current.quota).toEqual(mockQuota);
    });
  });

  it('should re-fetch subscription when userPlan changes', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const { rerender } = renderHook(({ userPlan }) => useAccountBilling(userPlan, refreshUserPlan), {
      initialProps: { userPlan: 'free' as any },
    });

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/billing/subscription'), expect.any(Object));
    vi.clearAllMocks();

    rerender({ userPlan: 'legend' as any });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/billing/subscription'), expect.any(Object));
  });

  it('should handle handleUpgrade successfully', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');
    const checkoutUrl = 'https://stripe.com/checkout';

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: checkoutUrl }),
    });

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleUpgrade();
    });

    expect(analytics.track).toHaveBeenCalledWith('upgrade_clicked', expect.any(Object));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/billing/create-checkout-session'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ priceId: ACCOUNT_UPGRADE_PRICE.priceId }),
    }));
    expect(window.location.href).toBe(checkoutUrl);
  });

  it('should handle handleUpgrade failure (no token)', async () => {
    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleUpgrade();
    });

    expect(toast.error).toHaveBeenCalledWith('Please sign in to upgrade');
  });

  it('should handle handleManageSubscription successfully', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');
    const portalUrl = 'https://stripe.com/portal';

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: portalUrl }),
    });

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleManageSubscription();
    });

    expect(analytics.track).toHaveBeenCalledWith('manage_subscription_clicked');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/billing/portal-session'), expect.objectContaining({
      method: 'POST',
    }));
    expect(window.location.href).toBe(portalUrl);
  });

  it('should handle handleManageSubscription failure (no token)', async () => {
    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleManageSubscription();
    });

    expect(toast.error).toHaveBeenCalledWith('Please sign in');
  });

  it('should handle API errors in handleUpgrade', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Stripe error' }),
    });

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleUpgrade();
    });

    expect(toast.error).toHaveBeenCalledWith('Stripe error');
    expect(analytics.track).toHaveBeenCalledWith('checkout_error', { error: 'Stripe error' });
  });

  it('should handle API errors without error message in handleUpgrade', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleUpgrade();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to create checkout session');
    expect(analytics.track).toHaveBeenCalledWith('checkout_error', { error: 'unknown' });
  });

  it('should handle unexpected errors in handleUpgrade', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleUpgrade();
    });

    expect(toast.error).toHaveBeenCalledWith('Network error');
  });

  it('should handle non-Error objects thrown in handleUpgrade', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockRejectedValue('String error');

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleUpgrade();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to start upgrade');
  });

  it('should handle API errors in handleManageSubscription', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Portal error' }),
    });

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleManageSubscription();
    });

    expect(toast.error).toHaveBeenCalledWith('Portal error');
  });

  it('should handle API errors without error message in handleManageSubscription', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleManageSubscription();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to open billing portal');
  });

  it('should handle unexpected errors in handleManageSubscription', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleManageSubscription();
    });

    expect(toast.error).toHaveBeenCalledWith('Network error');
  });

  it('should handle non-Error objects thrown in handleManageSubscription', async () => {
    window.localStorage.setItem('workos_access_token', 'test-token');

    (global.fetch as any).mockRejectedValue('String error');

    const { result } = renderHook(() => useAccountBilling('free', refreshUserPlan));

    await act(async () => {
      await result.current.handleManageSubscription();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to open billing portal');
  });
});
