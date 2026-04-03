/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useImageHotLoading, useCampaignImageHotLoading, useCharacterImageHotLoading } from '../use-image-hot-loading';

import { supabase } from '@/integrations/supabase/client';
import { subscriptionManager } from '@/services/supabase-subscription-manager';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}));

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

// Mock Subscription Manager
vi.mock('@/services/supabase-subscription-manager', () => ({
  subscriptionManager: {
    subscribe: vi.fn(() => 'test-sub-id'),
    unsubscribe: vi.fn(),
  },
}));

// Mock Network Utils
vi.mock('@/utils/network', () => ({
  isOffline: vi.fn(() => false),
  addNetworkListener: vi.fn(),
}));

describe('useImageHotLoading', () => {
  const mockRecordId = 'test-record-id';
  const mockTableName = 'characters';
  const mockFallbackImage = '/fallback.png';
  const mockImageUrl = 'https://example.com/image.png';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with loading state and fetch initial image', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: { background_image: mockImageUrl },
      error: null,
    });

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() =>
      useImageHotLoading({
        tableName: mockTableName,
        recordId: mockRecordId,
        fallbackImage: mockFallbackImage,
      })
    );

    // Initial state
    expect(result.current.isLoading).toBe(true);
    expect(result.current.imageUrl).toBe(mockFallbackImage);

    // Wait for fetch to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 2000 });

    expect(result.current.imageUrl).toBe(mockImageUrl);
    expect(result.current.hasImage).toBe(true);
  });

  it('should handle fetch errors gracefully', async () => {
    const mockSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database error' },
    });

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() =>
      useImageHotLoading({
        tableName: mockTableName,
        recordId: mockRecordId,
        fallbackImage: mockFallbackImage,
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 2000 });

    expect(result.current.error).toBe('Database error');
  });

  it('should update image via realtime subscription', async () => {
    let subscriptionCallback: (url: string | null) => void = () => {};
    (subscriptionManager.subscribe as any).mockImplementation(
      (_table: any, _id: any, _field: any, cb: any) => {
        subscriptionCallback = cb;
        return 'test-sub-id';
      }
    );

    const mockSingle = vi.fn().mockResolvedValue({
      data: { background_image: null },
      error: null,
    });

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() =>
      useImageHotLoading({
        tableName: mockTableName,
        recordId: mockRecordId,
        fallbackImage: mockFallbackImage,
      })
    );

    // Initial state after fetch
    await waitFor(() => {
      expect(result.current.imageUrl).toBe(mockFallbackImage);
    });

    // Simulate realtime update
    act(() => {
      subscriptionCallback(mockImageUrl);
    });

    expect(result.current.imageUrl).toBe(mockImageUrl);
    expect(result.current.hasImage).toBe(true);
  });

  describe('polling', () => {
    it('should start polling for newly created records without an image', async () => {
      const createdAt = new Date().toISOString();

      const mockSingleInitial = vi.fn().mockResolvedValue({
        data: { background_image: null },
        error: null,
      });

      const mockSinglePolling = vi.fn().mockResolvedValue({
        data: { background_image: mockImageUrl },
        error: null,
      });

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingleInitial,
      });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          fallbackImage: mockFallbackImage,
          createdAt,
        })
      );

      await waitFor(() => {
        expect(result.current.pollingActive).toBe(true);
      }, { timeout: 2000 });

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSinglePolling,
      });

      await waitFor(() => {
        expect(result.current.imageUrl).toBe(mockImageUrl);
        expect(result.current.pollingActive).toBe(false);
      }, { timeout: 4000 });
    });

    it('should timeout polling after 30 seconds', async () => {
       vi.useFakeTimers();
       const now = 1700000000000;
       vi.setSystemTime(now);
       const createdAt = new Date(now - 1000).toISOString();

       (supabase.from as any).mockReturnValue({
         select: vi.fn().mockReturnThis(),
         eq: vi.fn().mockReturnThis(),
         single: vi.fn().mockResolvedValue({ data: { background_image: null }, error: null }),
       });

       const { result } = renderHook(() =>
         useImageHotLoading({
           tableName: mockTableName,
           recordId: mockRecordId,
           fallbackImage: mockFallbackImage,
           createdAt,
         })
       );

       await act(async () => {
         await vi.advanceTimersByTimeAsync(0);
       });

       expect(result.current.pollingActive).toBe(true);

       // Advance by 31 seconds
       await act(async () => {
         await vi.advanceTimersByTimeAsync(31000);
       });

       expect(result.current.pollingActive).toBe(false);
       expect(result.current.isLoading).toBe(false);

       vi.useRealTimers();
    });

    it('should NOT poll if record is old', async () => {
        const oldDate = new Date(Date.now() - 120000).toISOString(); // 2 minutes ago

        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { background_image: null }, error: null }),
        });

        const { result } = renderHook(() =>
            useImageHotLoading({
                tableName: mockTableName,
                recordId: mockRecordId,
                createdAt: oldDate,
            })
        );

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        }, { timeout: 3000 });

        expect(result.current.pollingActive).toBe(false);
    });

    it('should NOT poll if created_at is in future (clock skew)', async () => {
        const futureDate = new Date(Date.now() + 10000).toISOString(); // 10 seconds in future

        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { background_image: null }, error: null }),
        });

        const { result } = renderHook(() =>
            useImageHotLoading({
                tableName: mockTableName,
                recordId: mockRecordId,
                createdAt: futureDate,
            })
        );

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        }, { timeout: 3000 });

        expect(result.current.pollingActive).toBe(false);
    });

    it('should handle polling fetch errors', async () => {
        const createdAt = new Date().toISOString();

        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValueOnce({ data: { background_image: null }, error: null })
                           .mockResolvedValueOnce({ data: null, error: { message: 'Network error' } })
                           .mockResolvedValueOnce({ data: { background_image: mockImageUrl }, error: null })
        });

        const { result } = renderHook(() =>
            useImageHotLoading({
                tableName: mockTableName,
                recordId: mockRecordId,
                createdAt,
            })
        );

        await waitFor(() => {
            expect(result.current.pollingActive).toBe(true);
        }, { timeout: 2000 });

        // First poll fails, second poll succeeds
        await waitFor(() => {
            expect(result.current.imageUrl).toBe(mockImageUrl);
            expect(result.current.pollingActive).toBe(false);
        }, { timeout: 6000 });
    });

    it('should NOT poll if already has image', async () => {
        const createdAt = new Date().toISOString();

        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { background_image: mockImageUrl }, error: null })
        });

        const { result } = renderHook(() =>
            useImageHotLoading({
                tableName: mockTableName,
                recordId: mockRecordId,
                createdAt,
            })
        );

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.pollingActive).toBe(false);
    });

    it('should NOT poll if createdAt is invalid', async () => {
        (supabase.from as any).mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { background_image: null }, error: null })
        });

        const { result } = renderHook(() =>
            useImageHotLoading({
                tableName: mockTableName,
                recordId: mockRecordId,
                createdAt: 'invalid-date',
            })
        );

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.pollingActive).toBe(false);
    });
  });

  it('should handle unmount correctly', () => {
    const { unmount } = renderHook(() =>
      useImageHotLoading({
        tableName: mockTableName,
        recordId: mockRecordId,
      })
    );

    unmount();

    expect(subscriptionManager.unsubscribe).toHaveBeenCalledWith(mockTableName, 'test-sub-id');
  });

  it('should use convenience hooks correctly', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { background_image: mockImageUrl }, error: null }),
    });

    const { result: campaignResult } = renderHook(() => useCampaignImageHotLoading('camp-1'));
    const { result: characterResult } = renderHook(() => useCharacterImageHotLoading('char-1'));

    await waitFor(() => {
      expect(campaignResult.current.isLoading).toBe(false);
      expect(characterResult.current.isLoading).toBe(false);
    });

    expect(supabase.from).toHaveBeenCalledWith('campaigns');
    expect(supabase.from).toHaveBeenCalledWith('characters');
  });
});
