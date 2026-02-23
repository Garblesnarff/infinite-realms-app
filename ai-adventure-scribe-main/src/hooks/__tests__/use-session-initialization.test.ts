/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isSessionExpired } from '../game-session/session-utils';
import { useSessionInitialization } from '../game-session/use-session-initialization';

import { supabase } from '@/integrations/supabase/client';

// Mock dependencies BEFORE importing the hook
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../game-session/session-utils', () => ({
  isSessionExpired: vi.fn(),
  isValidSession: vi.fn().mockReturnValue(true),
}));

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
    // Default mock for supabase.from to avoid crashes
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockReturnThis(),
    });
  });

  it('should set state to idle if campaignId or characterId is missing', () => {
    renderHook(() => useSessionInitialization({ ...defaultProps, campaignId: undefined }));
    expect(mockSetSessionState).toHaveBeenCalledWith('idle');
  });

  it('should create a new session if forceNew is true', async () => {
    mockCreateGameSession.mockResolvedValue('new-session-id');

    renderHook(() => useSessionInitialization({ ...defaultProps, forceNew: true }));

    await waitFor(() => {
      expect(mockCreateGameSession).toHaveBeenCalledWith('camp-123', 'char-456');
    });
  });

  it('should load a specific session if specificSessionId is provided', async () => {
    const mockSession = { id: 'spec-session', status: 'active' };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
    });

    renderHook(() => useSessionInitialization({ ...defaultProps, specificSessionId: 'spec-session' }));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should resume an active session if found and not expired', async () => {
    const mockSession = { id: 'active-session', status: 'active' };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [mockSession], error: null }),
    });
    vi.mocked(isSessionExpired).mockReturnValue(false);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should cleanup and not resume if active session is expired', async () => {
    const mockSession = { id: 'expired-session', status: 'active' };
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [mockSession], error: null }),
    });
    vi.mocked(isSessionExpired).mockReturnValue(true);
    mockCreateGameSession.mockResolvedValue('new-session-id');

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockCleanupSession).toHaveBeenCalledWith('expired-session');
      expect(mockCreateGameSession).toHaveBeenCalled();
    });
  });

  it('should create continuation from last completed session', async () => {
    const mockCompletedSession = {
      id: 'completed-1',
      status: 'completed',
      session_number: 1,
      current_scene_description: 'forest'
    };
    const mockNewSession = { id: 'new-continuation', status: 'active' };

    const fromSpy = vi.spyOn(supabase, 'from');

    // First call: find recent sessions
    fromSpy.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [mockCompletedSession], error: null }),
    } as any);

    // Second call: insert continuation
    fromSpy.mockReturnValueOnce({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockNewSession, error: null }),
    } as any);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockNewSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should create first session if no existing sessions found', async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    mockCreateGameSession.mockResolvedValue('first-session-id');

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockCreateGameSession).toHaveBeenCalledWith('camp-123', 'char-456');
    });
  });

  it('should handle errors in session initialization', async () => {
    // Mock to throw to trigger catch block
    (supabase.from as any).mockImplementation(() => {
      throw new Error('Critical DB Error');
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        variant: 'destructive',
      }));
    });
  });

  it('should prevent concurrent initialization using refs', async () => {
    const mockSession = { id: 'active-session', status: 'active' };
    let resolvePromise: any;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(promise),
    });

    const { rerender } = renderHook((props) => useSessionInitialization(props), {
      initialProps: defaultProps,
    });

    // Rerender with same props
    rerender(defaultProps);

    resolvePromise({ data: [mockSession], error: null });

    await waitFor(() => {
      // Should still only call find recent sessions once because of initializingRef
      expect(supabase.from).toHaveBeenCalledTimes(1);
    });
  });

  it('should respect AbortSignal on unmount', async () => {
    let resolvePromise: any;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue(promise),
    });

    const { unmount } = renderHook(() => useSessionInitialization(defaultProps));

    unmount();
    mockMountedRef.current = false;

    resolvePromise({ data: [], error: null });

    // Wait a bit to ensure nothing else is called
    await new Promise(r => setTimeout(r, 10));

    expect(mockSetSessionState).not.toHaveBeenCalledWith('active');
    expect(mockCreateGameSession).not.toHaveBeenCalled();
  });
});
