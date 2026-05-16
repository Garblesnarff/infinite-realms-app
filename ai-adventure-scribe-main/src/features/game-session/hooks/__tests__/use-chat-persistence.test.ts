/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useChatPersistence } from '../use-chat-persistence';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// Mock dependencies BEFORE importing module under test
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('@/lib/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger: mockLogger,
    default: mockLogger,
  };
});

vi.mock('@/utils/error-handler', () => ({
  handleAsyncError: vi.fn(),
}));

describe('useChatPersistence', () => {
  const mockSessionId = 'test-session-id';
  const mockMessageId = 'test-message-id';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  describe('fetchHistory', () => {
    it('should return null if sessionId is not provided', async () => {
      const { result } = renderHook(() => useChatPersistence(undefined));
      let history;
      await act(async () => {
        history = await result.current.fetchHistory();
      });
      expect(history).toBeNull();
    });

    it('should fetch history successfully from Supabase', async () => {
      const mockHistoryData = [
        {
          id: '1',
          speaker_type: 'dm',
          message: 'Hello adventurer',
          timestamp: new Date().toISOString(),
        },
        {
          id: '2',
          speaker_type: 'player',
          message: 'Hello DM',
          timestamp: new Date().toISOString(),
        },
      ];

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockHistoryData, error: null }),
      });

      const { result } = renderHook(() => useChatPersistence(mockSessionId));

      let history;
      await act(async () => {
        history = await result.current.fetchHistory();
      });

      expect(history).toHaveLength(2);
      expect(history![0].role).toBe('assistant');
      expect(history![1].role).toBe('user');
      expect(supabase.from).toHaveBeenCalledWith('dialogue_history');
    });

    it('should return empty array if no history found', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const { result } = renderHook(() => useChatPersistence(mockSessionId));

      let history;
      await act(async () => {
        history = await result.current.fetchHistory();
      });

      expect(history).toEqual([]);
    });

    it('should handle fetch errors', async () => {
      const mockError = { message: 'Database error' };
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      });

      const { result } = renderHook(() => useChatPersistence(mockSessionId));

      let history;
      await act(async () => {
        history = await result.current.fetchHistory();
      });

      expect(history).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('saveMessageToDatabase', () => {
    const mockMessage: any = {
      id: mockMessageId,
      role: 'user',
      content: 'I attack!',
      timestamp: new Date(),
    };

    it('should save message and verify its existence', async () => {
      const mockFromSpy = vi.spyOn(supabase, 'from');

      // First call for insert
      (mockFromSpy as any).mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });

      // Second call for verification (waitForMessageToExist)
      (mockFromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: mockMessageId }, error: null }),
      });

      const { result } = renderHook(() => useChatPersistence(mockSessionId));

      let saved;
      await act(async () => {
        const savePromise = result.current.saveMessageToDatabase(mockMessage, mockSessionId);
        // Handle the microtasks for the verification retry if needed,
        // but here it should succeed on first try.
        saved = await savePromise;
      });

      expect(saved).toBe(true);
      expect(supabase.from).toHaveBeenCalledWith('dialogue_history');
    });

    it('should retry verification if not immediately found', async () => {
      const mockFromSpy = vi.spyOn(supabase, 'from');

      // Call for insert
      (mockFromSpy as any).mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });

      // First verification attempt (fails)
      (mockFromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Second verification attempt (succeeds)
      (mockFromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: mockMessageId }, error: null }),
      });

      const { result } = renderHook(() => useChatPersistence(mockSessionId));

      let saved;
      let savePromise: Promise<boolean>;

      await act(async () => {
        savePromise = result.current.saveMessageToDatabase(mockMessage, mockSessionId);
      });

      // Advance timers to trigger retry
      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      saved = await savePromise!;
      expect(saved).toBe(true);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Message verified in database after 1 retries'));
    });

    it('should return false if verification fails after max retries', async () => {
      const mockFromSpy = vi.spyOn(supabase, 'from');

      // Call for insert
      (mockFromSpy as any).mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });

      // Mock all verification attempts to fail
      (mockFromSpy as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const { result } = renderHook(() => useChatPersistence(mockSessionId));

      let savePromise: Promise<boolean>;
      await act(async () => {
        savePromise = result.current.saveMessageToDatabase(mockMessage, mockSessionId);
      });

      // Advance timers for all 5 retries
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          vi.advanceTimersByTime(1000); // Plenty of time
        });
      }

      const saved = await savePromise!;
      expect(saved).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Message verification failed after 5 retries'));
    });

    it('should return false if insert fails', async () => {
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: { message: 'Insert failed' } }),
      });

      const { result } = renderHook(() => useChatPersistence(mockSessionId));

      let saved;
      await act(async () => {
        saved = await result.current.saveMessageToDatabase(mockMessage, mockSessionId);
      });

      expect(saved).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Database insert FAILED:'), expect.anything());
    });
  });
});
