/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as sessionUtils from '../session-utils';
import { useSessionInitialization } from '../use-session-initialization';

import { userDataApi } from '@/services/user-data-api';

// use-session-initialization.ts (src/hooks/game-session/use-session-initialization.ts)
// no longer queries Supabase directly - it now resolves sessions through
// userDataApi.getSession()/listSessions()/createSession() (real fetch() calls to the
// Bun server, see src/services/user-data-api.ts), so the mock target was updated to
// match. Note the IDOR check that used to be a `.eq('campaign_id', ...).eq('character_id', ...)`
// filter is still enforced in-app: the hook fetches by id alone and then verifies
// `candidate.campaign_id === campaignId && candidate.character_id === characterId`
// before trusting the session (see lines ~146-151 of the source).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSession: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    fetchSessionFallenState: vi.fn(),
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

    // Default userDataApi mock behavior: no existing sessions found.
    vi.mocked(userDataApi.listSessions).mockResolvedValue([]);
    // #2517: nobody has fallen unless a test says so.
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
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

  // Regression test for: refreshing the page (URL still has ?new=true) created a
  // second session instead of resuming the one just created, because nothing ever
  // told the caller to strip the forceNew param from the URL. See
  // onForceNewSessionCreated in use-session-initialization.ts.
  it('should invoke onForceNewSessionCreated after a forceNew session is created, so the caller can strip the URL param', async () => {
    mockCreateGameSession.mockResolvedValue('new-sess-id');
    const mockOnForceNewSessionCreated = vi.fn();

    renderHook(() =>
      useSessionInitialization({
        ...defaultProps,
        forceNew: true,
        onForceNewSessionCreated: mockOnForceNewSessionCreated,
      }),
    );

    await waitFor(() => {
      expect(mockOnForceNewSessionCreated).toHaveBeenCalledTimes(1);
    });
  });

  it('should NOT invoke onForceNewSessionCreated when session creation fails in the forceNew path', async () => {
    mockCreateGameSession.mockResolvedValue(null);
    const mockOnForceNewSessionCreated = vi.fn();

    renderHook(() =>
      useSessionInitialization({
        ...defaultProps,
        forceNew: true,
        onForceNewSessionCreated: mockOnForceNewSessionCreated,
      }),
    );

    await waitFor(() => {
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
    });
    expect(mockOnForceNewSessionCreated).not.toHaveBeenCalled();
  });

  // Regression test: with forceNew absent (i.e. the param was stripped after refresh)
  // and an active session already on record, the hook must take the resume path
  // rather than creating a new session.
  it('should resume the active session when forceNew is absent, even though a session was just force-created', async () => {
    const mockSessions = [
      { id: 'sess-1', status: 'active', start_time: new Date().toISOString() },
    ] as any;
    vi.mocked(userDataApi.listSessions).mockResolvedValue(mockSessions);
    const mockOnForceNewSessionCreated = vi.fn();

    renderHook(() =>
      useSessionInitialization({
        ...defaultProps,
        forceNew: false,
        onForceNewSessionCreated: mockOnForceNewSessionCreated,
      }),
    );

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSessions[0]);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
    expect(mockCreateGameSession).not.toHaveBeenCalled();
    expect(mockOnForceNewSessionCreated).not.toHaveBeenCalled();
  });

  it('should load a specific session if specificSessionId is provided', async () => {
    // Source verifies campaign_id/character_id match in-app (IDOR guard), so the
    // mocked session must include the matching ids for the fetch to be trusted.
    const mockSession = {
      id: 'specific-id',
      status: 'active',
      campaign_id: 'camp-123',
      character_id: 'char-456',
    };
    vi.mocked(userDataApi.getSession).mockResolvedValue(mockSession);

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
    vi.mocked(userDataApi.getSession).mockRejectedValueOnce(new Error('Not found'));

    // Fall back to fetching recent sessions
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce([]);

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
    vi.mocked(userDataApi.listSessions).mockResolvedValue(mockSessions);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSessions[0]);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  it('should cleanup an expired session and continue from it', async () => {
    const mockSessions = [
      { id: 'sess-expired', status: 'active', start_time: '2020-01-01' },
    ];
    vi.mocked(userDataApi.listSessions).mockResolvedValue(mockSessions);
    vi.mocked(sessionUtils.isSessionExpired).mockReturnValue(true);
    // The cleanup completes the expired session, making it the
    // continuation source — the stale in-memory row must not be missed.
    const continuation = { id: 'sess-next', status: 'active', session_number: 2 };
    vi.mocked(userDataApi.createSession).mockResolvedValue(continuation);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockCleanupSession).toHaveBeenCalledWith('sess-expired');
      expect(mockSetSessionData).toHaveBeenCalledWith(continuation);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
    // The fallen check ran against the just-cleaned-up session (the
    // in-memory row still says active, so a stale scan would miss it).
    expect(vi.mocked(userDataApi.fetchSessionFallenState)).toHaveBeenCalledWith('sess-expired');
    expect(vi.mocked(userDataApi.createSession)).toHaveBeenCalledWith(
      expect.objectContaining({ session_number: 2, campaign_id: 'camp-123' }),
    );
    expect(mockCreateGameSession).not.toHaveBeenCalled();
  });

  it('should continue from last completed session', async () => {
    const mockSessions = [
      { id: 'sess-old', status: 'completed', session_number: 1, current_scene_description: 'Scene' },
    ];
    // First call: fetch existing
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce(mockSessions);

    const newSession = { id: 'sess-new', status: 'active', session_number: 2 };
    // Second call: create continuation session
    vi.mocked(userDataApi.createSession).mockResolvedValueOnce(newSession);

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(newSession);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
  });

  // #2517: since the death fix, the session a character dies in is completed
  // server-side. Reloading the game URL without ?session= must resume THAT
  // session — creating a continuation would leave the end state reading an
  // empty session and "Read the story so far" blank (run D2's reload repro).
  it('#2517: resumes the session the character fell in instead of creating a new one', async () => {
    const mockSessions = [
      { id: 'sess-dead', status: 'completed', session_number: 1, current_scene_description: 'Scene' },
    ];
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce(mockSessions);
    // Follows the real producer: fetchSessionFallenState reads the session's
    // character_stats.vital_state from the session load payload.
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue({
      characterId: 'char-456',
      characterName: 'The Scholar',
      campaignId: 'camp-123',
      campaignName: 'Abyssal Descent',
      starterCampaignId: null,
      diedAt: '2026-10-02T14:51:00.000Z',
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSessions[0]);
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
    });
    expect(vi.mocked(userDataApi.fetchSessionFallenState)).toHaveBeenCalledWith('sess-dead');
    expect(userDataApi.createSession).not.toHaveBeenCalled();
    expect(mockCreateGameSession).not.toHaveBeenCalled();
  });

  it('should handle error when fetching existing sessions', async () => {
    vi.mocked(userDataApi.listSessions).mockRejectedValue(new Error('DB error'));
    mockCreateGameSession.mockResolvedValue('new-id');

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockCreateGameSession).toHaveBeenCalled();
    });
  });

  it('should handle error during continuation creation', async () => {
    const mockSessions = [{ id: 'sess-old', status: 'completed' }];
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce(mockSessions);
    vi.mocked(userDataApi.createSession).mockRejectedValueOnce(new Error('Insert failed'));

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
    // With no existing sessions, the "no existing sessions found" branch calls the
    // createGameSession prop directly and it is NOT wrapped in an inner try/catch (see
    // src/hooks/game-session/use-session-initialization.ts, ~line 280), so a rejection
    // there propagates up to the hook's outer catch block - unlike the old test, which
    // simulated a synchronous supabase.from() throw.
    vi.mocked(userDataApi.listSessions).mockResolvedValue([]);
    mockCreateGameSession.mockRejectedValue(new Error('Unexpected error'));

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Error' }));
    });
  });

  it('should handle unmounted state in async operations', async () => {
    vi.mocked(userDataApi.listSessions).mockImplementation(async () => {
      mockMountedRef.current = false;
      return [];
    });

    renderHook(() => useSessionInitialization(defaultProps));

    await waitFor(() => {
      // Should not call state setters if unmounted
      expect(mockSetSessionData).not.toHaveBeenCalled();
    });
  });
});
