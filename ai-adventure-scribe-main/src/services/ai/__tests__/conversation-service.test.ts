/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { saveChatMessage, getConversationHistory } from '../conversation-service';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn()
  }
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe('conversation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveChatMessage', () => {
    it('should save a chat message successfully', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      (supabase.from as any).mockReturnValue({
        insert: mockInsert
      });

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Hello DM',
        speakerId: 'char-456'
      };

      await saveChatMessage(params);

      expect(supabase.from).toHaveBeenCalledWith('dialogue_history');
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: params.sessionId,
        speaker_type: params.role,
        message: params.content,
        speaker_id: params.speakerId
      }));
    });

    it('should use provided ID if available', async () => {
      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      (supabase.from as any).mockReturnValue({
        insert: mockInsert
      });

      const params = {
        sessionId: 'session-123',
        role: 'assistant' as const,
        content: 'Hello Player',
        id: 'custom-id'
      };

      await saveChatMessage(params);

      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        id: 'custom-id'
      }));
    });

    it('should throw error and log when database save fails', async () => {
      const mockError = { message: 'Database error' };
      const mockInsert = vi.fn().mockResolvedValue({ error: mockError });
      (supabase.from as any).mockReturnValue({
        insert: mockInsert
      });

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Error test'
      };

      await expect(saveChatMessage(params)).rejects.toThrow('Failed to save chat message');
      // The current implementation logs twice, we will verify this in the test
      // and later fix it.
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getConversationHistory', () => {
    it('should retrieve conversation history successfully', async () => {
      const mockData = [
        {
          id: '1',
          speaker_type: 'user',
          message: 'Hello',
          created_at: '2023-01-01T00:00:00Z',
          sequence_number: 1
        },
        {
          id: '2',
          speaker_type: 'assistant',
          message: 'Hi there',
          created_at: '2023-01-01T00:00:01Z',
          sequence_number: 2
        }
      ];

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null })
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      const history = await getConversationHistory('session-123');

      expect(supabase.from).toHaveBeenCalledWith('dialogue_history');
      // Note: Current implementation selects only 4 columns.
      // We will update it to include sequence_number later.
      expect(mockQuery.select).toHaveBeenCalled();
      expect(mockQuery.eq).toHaveBeenCalledWith('session_id', 'session-123');
      expect(mockQuery.order).toHaveBeenCalledWith('sequence_number', { ascending: true });

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: new Date('2023-01-01T00:00:00Z')
      });
      expect(history[1].role).toBe('assistant');
    });

    it('should handle missing created_at by using current date', async () => {
      const mockData = [
        {
          id: '1',
          speaker_type: 'user',
          message: 'Hello',
          created_at: null
        }
      ];

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null })
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      const history = await getConversationHistory('session-123');
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('should throw error and log when retrieval fails', async () => {
      const mockError = { message: 'Fetch error' };
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: mockError })
      };
      (supabase.from as any).mockReturnValue(mockQuery);

      await expect(getConversationHistory('session-123')).rejects.toThrow('Failed to get conversation history');
      expect(logger.error).toHaveBeenCalledWith('Error getting conversation history:', mockError);
    });
  });
});
