/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChatPersistence } from '../chat-persistence';

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

describe('ChatPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('saveChatMessage', () => {
    it('should save a chat message successfully', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });
      (supabase.from as any).mockImplementation(mockFrom);

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Hello world',
        speakerId: 'speaker-456',
        id: 'msg-789',
      };

      await ChatPersistence.saveChatMessage(params);

      expect(supabase.from).toHaveBeenCalledWith('dialogue_history');
      expect(mockFrom().insert).toHaveBeenCalledWith({
        id: 'msg-789',
        session_id: 'session-123',
        speaker_type: 'user',
        speaker_id: 'speaker-456',
        message: 'Hello world',
      });
    });

    it('should generate a UUID if no id is provided', async () => {
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });
      (supabase.from as any).mockImplementation(mockFrom);

      // Mock crypto.randomUUID if it exists, or define it
      if (typeof crypto === 'undefined') {
        (global as any).crypto = { randomUUID: vi.fn().mockReturnValue('random-uuid') };
      } else if (!crypto.randomUUID) {
        (crypto as any).randomUUID = vi.fn().mockReturnValue('random-uuid');
      } else {
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('random-uuid' as any);
      }

      const params = {
        sessionId: 'session-123',
        role: 'assistant' as const,
        content: 'Response message',
      };

      await ChatPersistence.saveChatMessage(params);

      expect(mockFrom().insert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'random-uuid',
        })
      );
    });

    it('should throw an error and log it if supabase insertion fails', async () => {
      const mockError = { message: 'Insert failed' };
      const mockFrom = vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue({ error: mockError }),
      });
      (supabase.from as any).mockImplementation(mockFrom);

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Hello',
      };

      await expect(ChatPersistence.saveChatMessage(params)).rejects.toThrow('Failed to save chat message');
      expect(logger.error).toHaveBeenCalledWith('Error saving chat message:', mockError);
    });

    it('should catch and log unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected');
      (supabase.from as any).mockImplementation(() => {
        throw unexpectedError;
      });

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Hello',
      };

      await expect(ChatPersistence.saveChatMessage(params)).rejects.toThrow(unexpectedError);
      expect(logger.error).toHaveBeenCalledWith('Error saving chat message:', unexpectedError);
    });
  });

  describe('getConversationHistory', () => {
    it('should return mapped conversation history on success', async () => {
      const mockData = [
        {
          id: '1',
          speaker_type: 'user',
          message: 'Hello',
          created_at: '2023-01-01T00:00:00Z',
          sequence_number: 1,
        },
        {
          id: '2',
          speaker_type: 'assistant',
          message: 'Hi there',
          created_at: '2023-01-01T00:00:05Z',
          sequence_number: 2,
        },
      ];

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      const history = await ChatPersistence.getConversationHistory('session-123');

      expect(supabase.from).toHaveBeenCalledWith('dialogue_history');
      expect(mockQuery.select).toHaveBeenCalledWith('id, speaker_type, message, created_at, sequence_number');
      expect(mockQuery.eq).toHaveBeenCalledWith('session_id', 'session-123');
      expect(mockQuery.order).toHaveBeenCalledWith('sequence_number', { ascending: true });

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: new Date('2023-01-01T00:00:00Z'),
      });
      expect(history[1]).toEqual({
        id: '2',
        role: 'assistant',
        content: 'Hi there',
        timestamp: new Date('2023-01-01T00:00:05Z'),
      });
    });

    it('should handle missing created_at with current date', async () => {
      const mockData = [
        {
          id: '1',
          speaker_type: 'user',
          message: 'Hello',
          created_at: null,
          sequence_number: 1,
        },
      ];

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      const now = new Date('2023-05-05T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const history = await ChatPersistence.getConversationHistory('session-123');

      expect(history[0].timestamp).toEqual(now);
    });

    it('should throw and log error if query fails', async () => {
      const mockError = { message: 'Fetch failed' };
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      await expect(ChatPersistence.getConversationHistory('session-123')).rejects.toThrow('Failed to get conversation history');
      expect(logger.error).toHaveBeenCalledWith('Error getting conversation history:', mockError);
    });

    it('should catch and log unexpected errors during fetch', async () => {
      const unexpectedError = new Error('Unexpected');
      (supabase.from as any).mockImplementation(() => {
        throw unexpectedError;
      });

      await expect(ChatPersistence.getConversationHistory('session-123')).rejects.toThrow(unexpectedError);
      expect(logger.error).toHaveBeenCalledWith('Error getting conversation history:', unexpectedError);
    });
  });
});
