/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createGameSession,
  generateSessionSummary,
  cleanupSession,
  isSessionExpired,
} from '../session-utils';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('session/session-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createGameSession', () => {
    it('should create a new game session and return its id', async () => {
      const mockSession = { id: 'new-session-id' };
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });

      const result = await createGameSession();
      expect(result).toBe('new-session-id');
      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
    });

    it('should return null and log error on failure', async () => {
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Insert failed' } }),
      });

      const result = await createGameSession();
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('generateSessionSummary', () => {
    it('should generate a summary based on dialogue history', async () => {
      const mockMessages = [
        { message: 'msg1', speaker_type: 'player' },
        { message: 'msg2', speaker_type: 'dm' },
        { message: 'msg3', speaker_type: 'player' },
      ];
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockMessages, error: null }),
      });

      const summary = await generateSessionSummary('sess-1');
      expect(summary).toBe('Session completed with 3 total interactions: 2 player actions and 1 DM responses.');
    });

    it('should return default message if no messages found', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const summary = await generateSessionSummary('sess-1');
      expect(summary).toBe('No activity recorded in this session');
    });

    it('should return default message if data is null', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const summary = await generateSessionSummary('sess-1');
      expect(summary).toBe('No activity recorded in this session');
    });
  });

  describe('cleanupSession', () => {
    it('should update session status and return summary', async () => {
      const mockMessages = [{ message: 'msg1', speaker_type: 'player' }];

      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'dialogue_history') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: mockMessages, error: null }),
          };
        }
        if (table === 'game_sessions') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        }
      });

      const summary = await cleanupSession('sess-1');
      expect(summary).toContain('1 total interactions');
      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
    });

    it('should log error if update fails', async () => {
      (supabase.from as any).mockImplementation((table: string) => {
        if (table === 'dialogue_history') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'game_sessions') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
          };
        }
      });

      await cleanupSession('sess-1');
      expect(logger.error).toHaveBeenCalledWith('Error cleaning up session:', expect.anything());
    });
  });

  describe('isSessionExpired', () => {
    it('should return true if session is expired', () => {
      const startTime = new Date(Date.now() - 10000).toISOString();
      const session = { start_time: startTime } as any;
      expect(isSessionExpired(session, 5000)).toBe(true);
    });

    it('should return false if session is not expired', () => {
      const startTime = new Date(Date.now() - 1000).toISOString();
      const session = { start_time: startTime } as any;
      expect(isSessionExpired(session, 5000)).toBe(false);
    });
  });
});
