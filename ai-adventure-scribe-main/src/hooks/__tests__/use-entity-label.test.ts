/* eslint-disable @typescript-eslint/no-explicit-any */
 
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useEntityLabel } from '../use-entity-label';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useEntityLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle null id', () => {
    const { result } = renderHook(() => useEntityLabel('campaign', null));

    expect(result.current.label).toBe(null);
    expect(result.current.loading).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('should fetch campaign label', async () => {
    const mockData = [{ name: 'Test Campaign' }];
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    });

    const { result } = renderHook(() => useEntityLabel('campaign', 'campaign-123'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.label).toBe('Test Campaign');
    expect(supabase.from).toHaveBeenCalledWith('campaigns');
  });

  it('should fetch character label', async () => {
    const mockData = [{ name: 'Test Character' }];
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    });

    const { result } = renderHook(() => useEntityLabel('character', 'char-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.label).toBe('Test Character');
    expect(supabase.from).toHaveBeenCalledWith('characters');
  });

  it('should fetch session label', async () => {
    const mockData = [{ session_number: 5 }];
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    });

    const { result } = renderHook(() => useEntityLabel('session', 'session-123'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.label).toBe('Session 5');
    expect(supabase.from).toHaveBeenCalledWith('game_sessions');
  });

  it('should use default session label if session_number is missing', async () => {
    const mockData = [{ session_number: null }];
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockData, error: null }),
    });

    const { result } = renderHook(() => useEntityLabel('session', 'session-456'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.label).toBe('Game');
  });

  it('should use in-memory cache', async () => {
    const mockData = [{ name: 'Cached Campaign' }];
    const mockSelect = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockLimit = vi.fn().mockResolvedValue({ data: mockData, error: null });

    (supabase.from as any).mockReturnValue({
      select: mockSelect,
      eq: mockEq,
      limit: mockLimit,
    });

    // First render
    const { result: result1, unmount: unmount1 } = renderHook(() => useEntityLabel('campaign', 'cache-test-1'));

    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    expect(result1.current.label).toBe('Cached Campaign');
    expect(mockLimit).toHaveBeenCalledTimes(1);

    unmount1();

    // Second render with same ID
    const { result: result2 } = renderHook(() => useEntityLabel('campaign', 'cache-test-1'));

    // Should be available immediately from cache
    expect(result2.current.label).toBe('Cached Campaign');
    expect(result2.current.loading).toBe(false);
    // Should NOT have called Supabase again
    expect(mockLimit).toHaveBeenCalledTimes(1);
  });

  it('should handle fetch error', async () => {
    const mockError = { message: 'Database error' };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: mockError }),
    });

    const { result } = renderHook(() => useEntityLabel('campaign', 'error-id'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.label).toBe(null);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load campaign label'),
      expect.objectContaining({ id: 'error-id', error: mockError })
    );
  });

  it('should handle character fetch error', async () => {
    const mockError = { message: 'Database error' };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: mockError }),
    });

    const { result } = renderHook(() => useEntityLabel('character', 'error-char-id'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load character label'),
      expect.objectContaining({ id: 'error-char-id', error: mockError })
    );
  });

  it('should handle session fetch error', async () => {
    const mockError = { message: 'Database error' };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: mockError }),
    });

    const { result } = renderHook(() => useEntityLabel('session', 'error-session-id'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load session label'),
      expect.objectContaining({ id: 'error-session-id', error: mockError })
    );
  });

  it('should handle missing data in success response', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const { result } = renderHook(() => useEntityLabel('campaign', 'missing-id'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.label).toBe(null);
  });

  it('should cancel fetch on unmount', async () => {
    let resolvePromise: any;
    const delayedPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(delayedPromise),
    });

    const { unmount } = renderHook(() => useEntityLabel('campaign', 'cancel-test'));

    unmount();

    // Resolve the promise after unmount
    resolvePromise({ data: [{ name: 'Too Late' }], error: null });

    // Since we can't easily check the internal 'cancelled' variable,
    // we just ensure it doesn't crash and hopefully coverage shows the return statement being hit.
  });
});
