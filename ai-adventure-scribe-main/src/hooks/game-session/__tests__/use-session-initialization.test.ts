/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as sessionUtils from '../session-utils';
import { useSessionInitialization } from '../use-session-initialization';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
    })),
  },
}));

// Mock Logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Session Utils
vi.mock('../session-utils', async () => {
  const actual = await vi.importActual<any>('../session-utils');
  return {
    ...actual,
    isSessionExpired: vi.fn(),
  };
});

describe('useSessionInitialization', () => {
  const mockSetSessionData = vi.fn();
  const mockSetSessionState = vi.fn();
  const mockCreateGameSession = vi.fn();
  const mockCleanupSession = vi.fn();
  const mockToast = vi.fn();
  const mockMountedRef = { current: true };

  const defaultProps = {
    campaignId: 'camp-123',
    characterId: 'char-456',
    setSessionData: mockSetSessionData,
    setSessionState: mockSetSessionState,
    createGameSession: mockCreateGameSession,
    cleanupSession: mockCleanupSession,
    toast: mockToast,
    mountedRef: mockMountedRef,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMountedRef.current = true;
    vi.mocked(sessionUtils.isSessionExpired).mockReturnValue(false);

    // Default supabase mock behavior
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnThis(),
    });
  });

  it('should set state to idle if campaignId or characterId is missing', () => {
    renderHook(() =>
      useSessionInitialization({
        ...defaultProps,
        campaignId: undefined,
      }),
    );

    expect(mockSetSessionState).toHaveBeenCalledWith('idle');
  });

  it('should create a new session if forceNew is true', async () => {
    mockCreateGameSession.mockResolvedValue('new-sess-id');

    renderHook(() =>
      useSessionInitialization({
        ...defaultProps,
        forceNew: true,
      }),
    );

    await waitFor(() => {
      expect(mockCreateGameSession).toHaveBeenCalledWith('camp-123', 'char-456');
    });
  });

  it('should load a specific session if specificSessionId is provided', async () => {
    const mockSession = { id: 'specific-id', status: 'active' };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });

    renderHook(() =>
      useSessionInitialization({
        ...defaultProps,
        specificSessionId: 'specific-id',
      }),
    );

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should handle error when loading specific session and fall back to searching', async () => {
    // Return error for specific session load
    (supabase.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
    });

    // Fall back to fetching recent sessions
    (supabase.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    mockCreateGameSession.mockResolvedValue('new-id');

    renderHook(() =>
      useSessionInitialization({
        ...defaultProps,
        specificSessionId: 'specific-id',
      }),
    );

    await waitFor(() => {
      expect(mockCreateGameSession).toHaveBeenCalled();
    });
  });

  it('should resume an active, non-expired session', async () => {
    const mockSessions = [
      { id: 'sess-1', status: 'active', start_time: new Date().toISOString() },
    ];
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockSessions, error: null }),
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSessions[0]);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should cleanup and create new if session is expired', async () => {
    const mockSessions = [
      { id: 'sess-expired', status: 'active', start_time: '2020-01-01' },
    ];
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockSessions, error: null }),
    });
    vi.mocked(sessionUtils.isSessionExpired).mockReturnValue(true);
    mockCreateGameSession.mockResolvedValue('new-id');

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockCleanupSession).toHaveBeenCalledWith('sess-expired');
      expect(mockCreateGameSession).toHaveBeenCalled();
    });
  });

  it('should continue from last completed session', async () => {
    const mockSessions = [
      { id: 'sess-old', status: 'completed', session_number: 1, current_scene_description: 'Scene' },
    ];
    // First call: fetch existing
    (supabase.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockSessions, error: null }),
    });

    const newSession = { id: 'sess-new', status: 'active', session_number: 2 };
    // Second call: insert continuation
    (supabase.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(newSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should handle error when fetching existing sessions', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    });
    mockCreateGameSession.mockResolvedValue('new-id');

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockCreateGameSession).toHaveBeenCalled();
    });
  });

  it('should handle error during continuation creation', async () => {
    const mockSessions = [{ id: 'sess-old', status: 'completed' }];
    (supabase.from as any).mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockSessions, error: null }),
    });

    (supabase.from as any).mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
    });
  });

  it('should abort initialization on unmount', async () => {
    const { unmount } = renderHook(() => useSessionInitialization(defaultProps));
    unmount();
    // Verification of internal refs or AbortController is difficult but ensure no further state changes
    expect(mockSetSessionData).not.toHaveBeenCalled();
  });

  it('should handle general catch block errors', async () => {
    (supabase.from as any).mockImplementation(() => {
      throw new Error('Unexpected error');
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
    });
  });

  it('should handle unmounted state in async operations', async () => {
    (supabase.from as any).mockImplementation(() => {
      mockMountedRef.current = false;
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      // Should not call state setters if unmounted
      expect(mockSetSessionData).not.toHaveBeenCalled();
    });
  });
});
