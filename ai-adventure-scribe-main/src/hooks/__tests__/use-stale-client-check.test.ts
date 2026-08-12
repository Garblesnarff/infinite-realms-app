import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStaleClientCheck } from '../use-stale-client-check';

import { APP_BUILD_VERSION } from '@/services/app-version';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  reportClientFailure: vi.fn(),
  toast: vi.fn(() => ({ id: 'stale-client-toast' })),
  dismiss: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast, dismiss: mocks.dismiss }),
}));

const indexHtml = (version: string): string =>
  `<!doctype html><html><head><meta name="app-version" content="${version}" /></head></html>`;

describe('useStaleClientCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.fetch.mockResolvedValue(new Response(indexHtml(APP_BUILD_VERSION)));
  });

  it('checks the served index on focus and reports a mismatch once', async () => {
    const { result } = renderHook(() =>
      useStaleClientCheck({ isInCombat: false, sessionId: 'session-1' }),
    );

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    mocks.fetch.mockResolvedValue(new Response(indexHtml('new-build')));

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(result.current.isStale).toBe(true));
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'stale_client_detected',
      'session-1',
      `running=${APP_BUILD_VERSION}; served=new-build`,
    );
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New version available',
        description: 'Refresh to load the latest version.',
        duration: Infinity,
        action: expect.objectContaining({ label: 'Refresh' }),
      }),
    );

    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1));
  });

  it('defers the refresh toast until combat ends', async () => {
    mocks.fetch.mockResolvedValue(new Response(indexHtml('new-build')));

    const { result, rerender } = renderHook(
      ({ isInCombat }) => useStaleClientCheck({ isInCombat, sessionId: 'session-1' }),
      { initialProps: { isInCombat: true } },
    );

    await waitFor(() => expect(result.current.isStale).toBe(true));
    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();

    rerender({ isInCombat: false });

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledTimes(1));
  });
});
