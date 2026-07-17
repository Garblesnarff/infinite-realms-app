/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as sessionUtils from '../session-utils';
import { useSessionManagement } from '../use-session-management';

import { userDataApi } from '@/services/user-data-api';

// use-session-management.ts (src/hooks/game-session/use-session-management.ts) no longer
// talks to Supabase directly - createGameSession/cleanupSession/updateGameSessionState now
// call userDataApi.createSession()/completeSession()/updateSession() (real fetch() calls to
// the Bun server, see src/services/user-data-api.ts), so the mock target was updated to match.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createSession: vi.fn(),
    completeSession: vi.fn(),
    updateSession: vi.fn(),
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
vi.mock('../session-utils', () => ({
  isValidSession: vi.fn((s) => !!s && !!s.id),
  sanitizeSessionPatch: vi.fn((p) => {
    const {
      id,
      campaign_id,
      character_id,
      created_at,
      updated_at,
      sequence_number,
      ...rest
    } = p;
    const removed = [];
    if (id) removed.push('id');
    if (campaign_id) removed.push('campaign_id');
    if (character_id) removed.push('character_id');
    if (created_at) removed.push('created_at');
    if (updated_at) removed.push('updated_at');
    if (sequence_number) removed.push('sequence_number');
    return { sanitized: rest, removed };
  }),
  generateSessionSummary: vi.fn().mockResolvedValue('Summary'),
}));

describe('useSessionManagement', () => {
  const mockSetSessionData = vi.fn();
  const mockSetSessionState = vi.fn();
  const mockMountedRef = { current: true };
  const mockToastRef = { current: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMountedRef.current = true;
    // Default mock behavior
    mockSetSessionState.mockImplementation((updater) => {
      if (typeof updater === 'function') return updater('active');
      return updater;
    });
  });

  const setupHook = (props: any = {}): any => {
    return renderHook(() =>
      useSessionManagement({
        setSessionData: mockSetSessionData,
        setSessionState: mockSetSessionState,
        mountedRef: mockMountedRef,
        toastRef: mockToastRef,
        ...props,
      }),
    );
  };

  describe('createGameSession', () => {
    it('should create a session successfully', async () => {
      const mockSession = { id: 'sess-1' };
      vi.mocked(userDataApi.createSession).mockResolvedValue(mockSession);

      const { result } = setupHook({ starterCampaignId: 'starter-1' });
      let sessionId;
      await act(async () => {
        sessionId = await result.current.createGameSession('camp-1', 'char-1');
      });

      expect(sessionId).toBe('sess-1');
      expect(mockSetSessionState).toHaveBeenCalledWith('loading');
      expect(mockSetSessionState).toHaveBeenCalledWith('active');
      expect(mockSetSessionData).toHaveBeenCalledWith(mockSession);
    });

    it('should return null and toast if campaignId or characterId is missing', async () => {
      const { result } = setupHook();
      let sessionId;
      await act(async () => {
        sessionId = await result.current.createGameSession('', 'char-1');
      });

      expect(sessionId).toBeNull();
      expect(mockToastRef.current).toHaveBeenCalled();
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
    });

    it('should handle missing campaignId when unmounted', async () => {
      mockMountedRef.current = false;
      const { result } = setupHook();
      await act(async () => {
        await result.current.createGameSession('', 'char-1');
      });
      expect(mockSetSessionState).not.toHaveBeenCalledWith('error');
    });

    it('should handle Supabase errors', async () => {
      vi.mocked(userDataApi.createSession).mockRejectedValue(new Error('DB error'));

      const { result } = setupHook();
      let sessionId;
      await act(async () => {
        sessionId = await result.current.createGameSession('camp-1', 'char-1');
      });

      expect(sessionId).toBeNull();
      expect(mockSetSessionState).toHaveBeenCalledWith('error');
      expect(mockToastRef.current).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
    });

    it('should respect mountedRef after Supabase call', async () => {
      vi.mocked(userDataApi.createSession).mockImplementation(() => {
        mockMountedRef.current = false;
        return Promise.resolve({ id: 'sess-1' });
      });

      const { result } = setupHook();
      let sessionId;
      await act(async () => {
        sessionId = await result.current.createGameSession('camp-1', 'char-1');
      });

      expect(sessionId).toBeNull();
      expect(mockSetSessionData).not.toHaveBeenCalled();
    });
  });

  describe('cleanupSession', () => {
    it('should cleanup session successfully', async () => {
      vi.mocked(userDataApi.completeSession).mockResolvedValue(undefined);

      const { result } = setupHook();
      let summary;
      await act(async () => {
        summary = await result.current.cleanupSession('sess-1');
      });

      expect(summary).toBe('Summary');
      expect(mockSetSessionState).toHaveBeenCalledWith('ending');
      expect(mockSetSessionState).toHaveBeenCalledWith('expired');

      // Test the functional update in setSessionData
      const dataUpdater = mockSetSessionData.mock.calls.find(call => typeof call[0] === 'function')[0];
      const prevData = { id: 'sess-1', status: 'active' };
      const nextData = dataUpdater(prevData);
      expect(nextData.status).toBe('completed');

      const otherData = { id: 'other', status: 'active' };
      expect(dataUpdater(otherData)).toBe(otherData);
    });

    it('should return default summary if sessionId is missing', async () => {
      const { result } = setupHook();
      let summary;
      await act(async () => {
        summary = await result.current.cleanupSession('');
      });

      expect(summary).toBe('No activity recorded in this session');
    });

    it('should handle update error during cleanup', async () => {
      vi.mocked(userDataApi.completeSession).mockRejectedValue(new Error('Update error'));

      const { result } = setupHook();
      await act(async () => {
        await result.current.cleanupSession('sess-1');
      });

      expect(mockToastRef.current).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
      expect(mockSetSessionState).not.toHaveBeenCalledWith('expired');
    });

    it('should respect mountedRef during stages', async () => {
      vi.mocked(sessionUtils.generateSessionSummary).mockImplementationOnce(() => {
        mockMountedRef.current = false;
        return Promise.resolve('Summary');
      });

      const { result } = setupHook();
      let summary;
      await act(async () => {
        summary = await result.current.cleanupSession('sess-1');
      });

      expect(summary).toBe('Summary');
      expect(mockSetSessionState).toHaveBeenCalledWith('ending');
      expect(mockSetSessionState).not.toHaveBeenCalledWith('expired');
    });

    it('should respect mountedRef after Supabase update', async () => {
      vi.mocked(userDataApi.completeSession).mockImplementation(() => {
        mockMountedRef.current = false;
        return Promise.resolve(undefined);
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.cleanupSession('sess-1');
      });

      expect(mockSetSessionState).toHaveBeenCalledWith('ending');
      expect(mockSetSessionState).not.toHaveBeenCalledWith('expired');
    });
  });

  describe('updateGameSessionState', () => {
    const initialSession = { id: 'sess-1', turn_count: 1 };

    it('should update session state with object', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      vi.mocked(userDataApi.updateSession).mockResolvedValue({ ...initialSession, turn_count: 2 });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(userDataApi.updateSession).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({ turn_count: 2 }),
      );
      expect(mockSetSessionData).toHaveBeenCalled();
    });

    it('should handle functional updater', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      vi.mocked(userDataApi.updateSession).mockResolvedValue({ ...initialSession, turn_count: 2 });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState((prev: any) => ({
          turn_count: prev.turn_count + 1,
        }));
      });

      expect(mockSetSessionData).toHaveBeenCalled();
    });

    it('should handle null/undefined updater', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState(null as any);
        await result.current.updateGameSessionState(undefined as any);
      });
      expect(mockSetSessionData).not.toHaveBeenCalled();
    });

    it('should handle invalid candidate', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });
      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState(() => null as any);
      });
      expect(userDataApi.updateSession).not.toHaveBeenCalled();
    });

    it('should handle update with only immutable fields', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });
      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ id: 'new-id' });
      });
      expect(userDataApi.updateSession).not.toHaveBeenCalled();
    });

    it('should not update if session is loading', async () => {
      mockSetSessionState.mockImplementation((updater) => {
        if (typeof updater === 'function') return updater('loading');
        return updater;
      });

      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(userDataApi.updateSession).not.toHaveBeenCalled();
    });

    it('should not update if session is in error state', async () => {
      mockSetSessionState.mockImplementation((updater) => {
        if (typeof updater === 'function') return updater('error');
        return updater;
      });

      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(userDataApi.updateSession).not.toHaveBeenCalled();
    });

    it('should not update if session id is missing', async () => {
       mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater({}); // No id
        }
        return updater;
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(userDataApi.updateSession).not.toHaveBeenCalled();
    });

    it('should handle empty update', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({});
      });

      expect(userDataApi.updateSession).not.toHaveBeenCalled();
    });

    it('should handle Supabase update error', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      vi.mocked(userDataApi.updateSession).mockRejectedValue(new Error('Update failed'));

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(mockToastRef.current).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error' }),
      );
    });

    it('should respect mountedRef during update', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      vi.mocked(userDataApi.updateSession).mockImplementation(() => {
        mockMountedRef.current = false;
        return Promise.resolve({ id: 'sess-1' });
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(mockSetSessionData).toHaveBeenCalledTimes(1);
    });

    it('should respect mountedRef before Supabase call', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });
      mockMountedRef.current = false;

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(userDataApi.updateSession).not.toHaveBeenCalled();
    });
  });
});
