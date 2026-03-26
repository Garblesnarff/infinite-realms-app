/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useSimpleGameSession } from '../use-simple-game-session';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useSimpleGameSession', () => {
  const mockUser = { id: 'user-123' };
  const campaignId = 'campaign-456';
  const characterId = 'char-789';

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ user: mockUser });
  });

  it('should initialize with null session', () => {
    // Prevent useEffect from firing by not providing campaignId/characterId
    const { result } = renderHook(() => useSimpleGameSession());
    expect(result.current.session).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  describe('getActiveSession', () => {
    it('should resume an active session if found', async () => {
      const mockSession = { id: 'session-1', status: 'active', session_number: 1 };

      const mockFrom = vi.spyOn(supabase, 'from');
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockSession], error: null }),
      } as any);

      const { result } = renderHook(() => useSimpleGameSession());

      let session;
      await act(async () => {
        session = await result.current.getActiveSession(campaignId, characterId);
      });

      expect(session).toEqual(mockSession);
      expect(result.current.session).toEqual(mockSession);
      expect(mockFrom).toHaveBeenCalledWith('game_sessions');
    });

    it('should create a new session continuing from the last completed one', async () => {
      const lastCompletedSession = { id: 'session-1', status: 'completed', session_number: 5 };
      const newSession = { id: 'session-2', status: 'active', session_number: 6 };

      const mockFrom = vi.spyOn(supabase, 'from');

      // Mock get active session query
      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [lastCompletedSession], error: null }),
      });

      // Mock insert new session
      (mockFrom as any).mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
      });

      const { result } = renderHook(() => useSimpleGameSession());

      let session;
      await act(async () => {
        session = await result.current.getActiveSession(campaignId, characterId);
      });

      expect(session).toEqual(newSession);
      expect(result.current.session).toEqual(newSession);
      expect(mockFrom).toHaveBeenCalledWith('game_sessions');
    });

    it('should handle lastCompletedSession without session_number', async () => {
      const lastCompletedSession = { id: 'session-1', status: 'completed', session_number: null };
      const newSession = { id: 'session-2', status: 'active', session_number: 2 };

      const mockFrom = vi.spyOn(supabase, 'from');

      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [lastCompletedSession], error: null }),
      });

      const insertSpy = vi.fn().mockReturnThis();
      (mockFrom as any).mockReturnValueOnce({
        insert: insertSpy,
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
      });

      const { result } = renderHook(() => useSimpleGameSession());
      await act(async () => {
        await result.current.getActiveSession(campaignId, characterId);
      });

      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ session_number: 2 }));
    });

    it('should create the first session if none exist', async () => {
      const newSession = { id: 'session-1', status: 'active', session_number: 1 };

      const mockFrom = vi.spyOn(supabase, 'from');

      // Mock fetch existing (empty)
      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      // Mock count check (in createGameSession)
      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      // Mock insert
      (mockFrom as any).mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
      });

      const { result } = renderHook(() => useSimpleGameSession());

      let session;
      await act(async () => {
        session = await result.current.getActiveSession(campaignId, characterId);
      });

      expect(session).toEqual(newSession);
      expect(result.current.session).toEqual(newSession);
    });

    it('should handle error fetching existing sessions by creating a new one', async () => {
      const newSession = { id: 'session-new', status: 'active', session_number: 1 };
      const mockFrom = vi.spyOn(supabase, 'from');

      // Mock fetch existing fails
      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'Fetch fail' } }),
      });

      // In createGameSession:
      // Mock count check
      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });
      // Mock insert
      (mockFrom as any).mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
      });

      const { result } = renderHook(() => useSimpleGameSession());

      let session;
      await act(async () => {
        session = await result.current.getActiveSession(campaignId, characterId);
      });

      expect(logger.error).toHaveBeenCalled();
      expect(session).toEqual(newSession);
    });

    it('should handle general error in getActiveSession', async () => {
      const mockFrom = vi.spyOn(supabase, 'from');
      (mockFrom as any).mockImplementationOnce(() => {
        throw new Error('Unexpected error');
      });

      const { result } = renderHook(() => useSimpleGameSession());

      await act(async () => {
        try {
          await result.current.getActiveSession(campaignId, characterId);
        } catch (_error) {
          // Expected
        }
      });

      expect(result.current.error).toBe('Unexpected error');
    });
  });

  describe('createGameSession', () => {
    it('should throw error if user is not authenticated', async () => {
      (useAuth as any).mockReturnValue({ user: null });

      const { result } = renderHook(() => useSimpleGameSession());

      await expect(result.current.createGameSession(campaignId, characterId))
        .rejects.toThrow('User must be authenticated');
    });

    it('should increment session number correctly', async () => {
      const existingSession = { session_number: 2 };
      const newSession = { id: 'session-3', session_number: 3 };

      const mockFrom = vi.spyOn(supabase, 'from');

      // Mock count check
      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [existingSession], error: null }),
      });

      // Mock insert
      (mockFrom as any).mockReturnValueOnce({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
      });

      const { result } = renderHook(() => useSimpleGameSession());

      let session;
      await act(async () => {
        session = await result.current.createGameSession(campaignId, characterId);
      });

      expect(session.session_number).toBe(3);
    });

    it('should handle existingSessions without results', async () => {
       const newSession = { id: 'session-1', session_number: 1 };

      const mockFrom = vi.spyOn(supabase, 'from');

      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const insertSpy = vi.fn().mockReturnThis();
      (mockFrom as any).mockReturnValueOnce({
        insert: insertSpy,
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: newSession, error: null }),
      });

      const { result } = renderHook(() => useSimpleGameSession());
      await act(async () => {
        await result.current.createGameSession(campaignId, characterId);
      });
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ session_number: 1 }));
    });

    it('should handle error when session_number is missing in existing sessions', async () => {
      const existingSession = { session_number: null };
      const newSession = { id: 'session-1', session_number: 1 };

      const mockFrom = vi.spyOn(supabase, 'from');

      const insertSpy = vi.fn().mockReturnThis();
      const selectSpy = vi.fn().mockReturnThis();
      const singleSpy = vi.fn().mockResolvedValue({ data: newSession, error: null });

      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [existingSession], error: null }),
      });
      (mockFrom as any).mockReturnValueOnce({
        insert: insertSpy,
        select: selectSpy,
        single: singleSpy,
      });

      const { result } = renderHook(() => useSimpleGameSession());
      await act(async () => {
        await result.current.createGameSession(campaignId, characterId);
      });
      expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ session_number: 1 }));
    });

    it('should handle errors during creation', async () => {
      const mockFrom = vi.spyOn(supabase, 'from');
      (mockFrom as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } }),
      });

      const { result } = renderHook(() => useSimpleGameSession());

      await act(async () => {
        try {
          await result.current.createGameSession(campaignId, characterId);
        } catch (_error) {
          // Expected
        }
      });

      expect(result.current.error).toBe('Failed to create session');
    });

    it('should handle createGameSession when err is not an Error object', async () => {
       const mockFrom = vi.spyOn(supabase, 'from');
      (mockFrom as any).mockImplementationOnce(() => {
        throw 'String error';
      });

      const { result } = renderHook(() => useSimpleGameSession());

      await act(async () => {
        try {
          await result.current.createGameSession(campaignId, characterId);
        } catch (_error) {
          // Expected
        }
      });

      expect(result.current.error).toBe('Failed to create session');
    });
  });

  describe('endSession', () => {
    it('should update session status to completed', async () => {
      const initialSession = { id: 'session-1', status: 'active' };
      const mockFrom = vi.spyOn(supabase, 'from');

      (mockFrom as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const { result } = renderHook(() => useSimpleGameSession());

      // Manually trigger getActiveSession to set the session state
      (mockFrom as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [initialSession], error: null }),
      });

      await act(async () => {
        await result.current.getActiveSession(campaignId, characterId);
      });

      expect(result.current.session?.status).toBe('active');

      await act(async () => {
        await result.current.endSession('session-1', 'Test Summary');
      });

      expect(result.current.session?.status).toBe('completed');
      expect(result.current.session?.summary).toBe('Test Summary');
    });

    it('should handle error in endSession', async () => {
      const mockFrom = vi.spyOn(supabase, 'from');
      (mockFrom as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'Update fail' } }),
      });

      const { result } = renderHook(() => useSimpleGameSession());
      await act(async () => {
        try {
          await result.current.endSession('session-1');
        } catch (_error) {
          // Expected
        }
      });

      expect(result.current.error).toBe('Failed to end session');
    });

    it('should handle endSession when err is not an Error object', async () => {
       const mockFrom = vi.spyOn(supabase, 'from');
      (mockFrom as any).mockImplementationOnce(() => {
        throw 'String error';
      });

      const { result } = renderHook(() => useSimpleGameSession());

      await act(async () => {
        try {
          await result.current.endSession('session-1');
        } catch (_error) {
          // Expected
        }
      });

      expect(result.current.error).toBe('Failed to end session');
    });
  });

  describe('auto-loading', () => {
    it('should call getActiveSession on mount if all dependencies are present', async () => {
      const mockSession = { id: 'session-1', status: 'active' };
      const mockFrom = vi.spyOn(supabase, 'from');

      (mockFrom as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockSession], error: null }),
      });

      renderHook(() => useSimpleGameSession(campaignId, characterId));

      await waitFor(() => {
        expect(mockFrom).toHaveBeenCalledWith('game_sessions');
      });
    });
  });
});
