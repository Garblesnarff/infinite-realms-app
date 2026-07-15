/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isSessionExpired } from '../game-session/session-utils';
import { useSessionInitialization } from '../game-session/use-session-initialization';

import { userDataApi } from '@/services/user-data-api';

// useSessionInitialization was migrated from direct supabase.from('sessions') chains to
// userDataApi (the Bun server's REST API client) - see
// src/hooks/game-session/use-session-initialization.ts, which now calls
// userDataApi.getSession()/listSessions()/createSession(). The mock target was updated to
// match; SESSION_CORE_COLUMNS is no longer passed to a `select()` call anywhere in the hook
// (userDataApi always returns the full row), so assertions on it were removed.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSession: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
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

vi.mock('../game-session/session-utils', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    isSessionExpired: vi.fn(),
    isValidSession: vi.fn().mockReturnValue(true),
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
    // vi.clearAllMocks() only clears call history, not previously-set mock
    // implementations (mockResolvedValue persists across tests since these mocks are
    // declared once for the whole describe block) - explicitly reset each shared prop
    // mock's implementation here so a value set in one test can't leak into the next
    // (same issue documented in src/services/__tests__/llm-api-client.test.ts).
    mockSetSessionData.mockReset();
    mockSetSessionState.mockReset();
    mockCreateGameSession.mockReset();
    mockCleanupSession.mockReset();
    mockToast.mockReset();

    // Default mocks for userDataApi to avoid crashes / unhandled rejections
    vi.mocked(userDataApi.listSessions).mockResolvedValue([]);
    vi.mocked(userDataApi.getSession).mockResolvedValue(null);
    vi.mocked(userDataApi.createSession).mockResolvedValue({});
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
    // Source's specificSessionId path requires the fetched session's campaign_id/character_id
    // to match the requested ones (IDOR prevention), so both must be present on the mock.
    const mockSession = {
      id: 'spec-session',
      status: 'active',
      campaign_id: 'camp-123',
      character_id: 'char-456',
    };
    vi.mocked(userDataApi.getSession).mockResolvedValueOnce(mockSession);

    renderHook(() =>
      useSessionInitialization({ ...defaultProps, specificSessionId: 'spec-session' }),
    );

    await waitFor(() => {
      expect(userDataApi.getSession).toHaveBeenCalledWith('spec-session');
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should resume an active session if found and not expired', async () => {
    const mockSession = { id: 'active-session', status: 'active' };
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce([mockSession]);
    vi.mocked(isSessionExpired).mockReturnValue(false);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(userDataApi.listSessions).toHaveBeenCalledWith({
        campaignId: 'camp-123',
        characterId: 'char-456',
        limit: 5,
      });
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should cleanup and not resume if active session is expired', async () => {
    const mockSession = { id: 'expired-session', status: 'active' };
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce([mockSession]);
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
      current_scene_description: 'forest',
    };
    const mockNewSession = { id: 'new-continuation', status: 'active' };

    // First call: find recent sessions
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce([mockCompletedSession]);

    // Second call: create continuation session
    vi.mocked(userDataApi.createSession).mockResolvedValueOnce(mockNewSession);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockNewSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should create first session if no existing sessions found', async () => {
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce([]);
    mockCreateGameSession.mockResolvedValue('first-session-id');

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockCreateGameSession).toHaveBeenCalledWith('camp-123', 'char-456');
    });
  });

  it('should handle errors in session initialization', async () => {
    // Source now catches userDataApi.listSessions() failures locally (see
    // "Find recent sessions" in use-session-initialization.ts) and falls back to
    // createGameSession() instead of surfacing them via the outer catch block. To reach
    // the 'error' state we simulate both the lookup failing *and* the fallback session
    // creation failing (createGameSession resolving falsy), which triggers
    // handleSessionCreationFailure().
    vi.mocked(userDataApi.listSessions).mockRejectedValueOnce(new Error('Critical DB Error'));
    mockCreateGameSession.mockResolvedValueOnce(null);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
        }),
      );
    });
  });

  it('should prevent concurrent initialization using refs', async () => {
    const mockSession = { id: 'active-session', status: 'active' };
    let resolvePromise: any;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    vi.mocked(userDataApi.listSessions).mockReturnValue(promise as any);

    const { rerender } = renderHook((props) => useSessionInitialization(props), {
      initialProps: defaultProps,
    });

    // Rerender with same props
    rerender(defaultProps);

    resolvePromise([mockSession]);

    await waitFor(() => {
      // Should still only call find recent sessions once because of initializingRef
      expect(userDataApi.listSessions).toHaveBeenCalledTimes(1);
    });
  });

  it('should respect AbortSignal on unmount', async () => {
    let resolvePromise: any;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    vi.mocked(userDataApi.listSessions).mockReturnValue(promise as any);

    const { unmount } = renderHook(() => useSessionInitialization(defaultProps));

    unmount();
    mockMountedRef.current = false;

    resolvePromise([]);

    // Wait a bit to ensure nothing else is called
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSetSessionState).not.toHaveBeenCalledWith('active');
    expect(mockCreateGameSession).not.toHaveBeenCalled();
  });
});
