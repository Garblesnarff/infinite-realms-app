/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as sessionUtils from '../session-utils';
import { useSessionManagement } from '../use-session-management';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
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
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

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
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });

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
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          mockMountedRef.current = false;
          return Promise.resolve({ data: { id: 'sess-1' }, error: null });
        }),
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
      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

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
      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'Update error' } }),
      });

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
      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockImplementation(() => {
          mockMountedRef.current = false;
          return Promise.resolve({ error: null });
        }),
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

      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { ...initialSession, turn_count: 2 }, error: null }),
      });

      const { result } = setupHook();
      await act(async () => {
        await result.current.updateGameSessionState({ turn_count: 2 });
      });

      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
      expect(mockSetSessionData).toHaveBeenCalled();
    });

    it('should handle functional updater', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { ...initialSession, turn_count: 2 }, error: null }),
      });

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
      expect(supabase.from).not.toHaveBeenCalled();
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
      expect(supabase.from).not.toHaveBeenCalled();
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

      expect(supabase.from).not.toHaveBeenCalled();
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

      expect(supabase.from).not.toHaveBeenCalled();
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

      expect(supabase.from).not.toHaveBeenCalled();
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

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('should handle Supabase update error', async () => {
      mockSetSessionData.mockImplementation((updater) => {
        if (typeof updater === 'function') {
          return updater(initialSession);
        }
        return updater;
      });

      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Update failed' } }),
      });

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

      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          mockMountedRef.current = false;
          return Promise.resolve({ data: { id: 'sess-1' }, error: null });
        }),
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

      expect(supabase.from).not.toHaveBeenCalled();
    });
  });
});
