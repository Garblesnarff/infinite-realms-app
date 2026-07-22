import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCampaignJournal } from '../use-campaign-journal';

import { userDataApi } from '@/services/user-data-api';

// Mock the user-data-api service
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionJournal: vi.fn(),
  },
}));

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

describe('useCampaignJournal', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should not query or fetch if sessionId is null or undefined', () => {
    const { result } = renderHook(() => useCampaignJournal(null), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(userDataApi.getSessionJournal).not.toHaveBeenCalled();
  });

  it('should fetch campaign journal entries successfully when sessionId is provided', async () => {
    const mockJournalData = {
      entries: [
        {
          id: 'entry-1',
          title: 'Forest Adventure',
          content: 'Found a magical key.',
          created_at: new Date().toISOString(),
        },
      ],
    };

    vi.mocked(userDataApi.getSessionJournal).mockResolvedValue(mockJournalData);

    const { result } = renderHook(() => useCampaignJournal('test-session-id'), { wrapper });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(mockJournalData);
    expect(userDataApi.getSessionJournal).toHaveBeenCalledWith('test-session-id');
  });

  it('should invalidate campaign journal queries when campaign-journal-updated event is dispatched', async () => {
    const mockJournalData = { entries: [] };
    vi.mocked(userDataApi.getSessionJournal).mockResolvedValue(mockJournalData);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useCampaignJournal('test-session-id'), { wrapper });

    // Dispatch the window event
    const event = new Event('campaign-journal-updated');
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['campaign-journal', 'test-session-id'],
      });
    });
  });

  it('should clean up the window event listener when the hook is unmounted', async () => {
    const mockJournalData = { entries: [] };
    vi.mocked(userDataApi.getSessionJournal).mockResolvedValue(mockJournalData);

    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useCampaignJournal('test-session-id'), { wrapper });

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'campaign-journal-updated',
      expect.any(Function)
    );
  });
});
