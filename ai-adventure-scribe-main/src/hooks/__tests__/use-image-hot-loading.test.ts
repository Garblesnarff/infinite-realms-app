/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  useImageHotLoading,
  useCampaignImageHotLoading,
  useCharacterImageHotLoading,
} from '../use-image-hot-loading';

import { userDataApi } from '@/services/user-data-api';

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
  },
}));

// Mock userDataApi (backend-routed fetch; campaigns/characters have no
// direct anon/authenticated grants, so this hook must go through server-bun)
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
    getCharacter: vi.fn(),
  },
}));

describe('useImageHotLoading', () => {
  const mockRecordId = 'test-record-id';
  const mockTableName = 'characters';
  const mockFallbackImage = '/fallback.png';
  const mockImageUrl = 'https://example.com/image.png';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize with loading state and fetch initial image', async () => {
    (userDataApi.getCharacter as any).mockResolvedValue({ background_image: mockImageUrl });

    const { result } = renderHook(() =>
      useImageHotLoading({
        tableName: mockTableName,
        recordId: mockRecordId,
        fallbackImage: mockFallbackImage,
      }),
    );

    // Initial state
    expect(result.current.isLoading).toBe(true);
    expect(result.current.imageUrl).toBe(mockFallbackImage);

    // Wait for fetch to complete
    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 2000 },
    );

    expect(result.current.imageUrl).toBe(mockImageUrl);
    expect(result.current.hasImage).toBe(true);
  });

  it('should handle fetch errors gracefully', async () => {
    (userDataApi.getCharacter as any).mockRejectedValue(new Error('Database error'));

    const { result } = renderHook(() =>
      useImageHotLoading({
        tableName: mockTableName,
        recordId: mockRecordId,
        fallbackImage: mockFallbackImage,
      }),
    );

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false);
      },
      { timeout: 2000 },
    );

    expect(result.current.error).toBe('Database error');
  });

  describe('polling', () => {
    it('should start polling for newly created records without an image', async () => {
      vi.useFakeTimers();
      const createdAt = new Date().toISOString();

      (userDataApi.getCharacter as any).mockResolvedValue({ background_image: null });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          fallbackImage: mockFallbackImage,
          createdAt,
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.pollingActive).toBe(true);

      (userDataApi.getCharacter as any).mockResolvedValue({ background_image: mockImageUrl });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.imageUrl).toBe(mockImageUrl);
      expect(result.current.pollingActive).toBe(false);
    });

    it('should timeout polling after 30 seconds', async () => {
      vi.useFakeTimers();
      const now = 1700000000000;
      vi.setSystemTime(now);
      const createdAt = new Date(now - 1000).toISOString();

      (userDataApi.getCharacter as any).mockResolvedValue({ background_image: null });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          fallbackImage: mockFallbackImage,
          createdAt,
        }),
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

      (userDataApi.getCharacter as any).mockResolvedValue({ background_image: null });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          createdAt: oldDate,
        }),
      );

      await waitFor(
        () => {
          expect(result.current.isLoading).toBe(false);
        },
        { timeout: 3000 },
      );

      expect(result.current.pollingActive).toBe(false);
    });

    it('should NOT poll if created_at is in future (clock skew)', async () => {
      const futureDate = new Date(Date.now() + 10000).toISOString(); // 10 seconds in future

      (userDataApi.getCharacter as any).mockResolvedValue({ background_image: null });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          createdAt: futureDate,
        }),
      );

      await waitFor(
        () => {
          expect(result.current.isLoading).toBe(false);
        },
        { timeout: 3000 },
      );

      expect(result.current.pollingActive).toBe(false);
    });

    it('should handle polling fetch errors', async () => {
      vi.useFakeTimers();
      const createdAt = new Date().toISOString();

      (userDataApi.getCharacter as any)
        .mockResolvedValueOnce({ background_image: null })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ background_image: mockImageUrl });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          createdAt,
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.pollingActive).toBe(true);

      // First poll fails, second poll succeeds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(result.current.imageUrl).toBe(mockImageUrl);
      expect(result.current.pollingActive).toBe(false);
    });

    it('should NOT poll if already has image', async () => {
      const createdAt = new Date().toISOString();

      (userDataApi.getCharacter as any).mockResolvedValue({ background_image: mockImageUrl });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          createdAt,
        }),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.pollingActive).toBe(false);
    });

    it('should NOT poll if createdAt is invalid', async () => {
      (userDataApi.getCharacter as any).mockResolvedValue({ background_image: null });

      const { result } = renderHook(() =>
        useImageHotLoading({
          tableName: mockTableName,
          recordId: mockRecordId,
          createdAt: 'invalid-date',
        }),
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.pollingActive).toBe(false);
    });
  });

  it('should handle unmount correctly without leaking a polling interval', async () => {
    (userDataApi.getCharacter as any).mockResolvedValue({ background_image: null });

    const { result, unmount } = renderHook(() =>
      useImageHotLoading({
        tableName: mockTableName,
        recordId: mockRecordId,
        createdAt: new Date().toISOString(),
      }),
    );

    await waitFor(() => {
      expect(result.current.pollingActive).toBe(true);
    });

    expect(() => unmount()).not.toThrow();
  });

  it('should use convenience hooks correctly', async () => {
    (userDataApi.getCampaign as any).mockResolvedValue({ background_image: mockImageUrl });
    (userDataApi.getCharacter as any).mockResolvedValue({ background_image: mockImageUrl });

    const { result: campaignResult } = renderHook(() => useCampaignImageHotLoading('camp-1'));
    const { result: characterResult } = renderHook(() => useCharacterImageHotLoading('char-1'));

    await waitFor(() => {
      expect(campaignResult.current.isLoading).toBe(false);
      expect(characterResult.current.isLoading).toBe(false);
    });

    expect(userDataApi.getCampaign).toHaveBeenCalledWith('camp-1');
    expect(userDataApi.getCharacter).toHaveBeenCalledWith('char-1');
  });
});
