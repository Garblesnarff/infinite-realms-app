/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { saveChatMessage, getConversationHistory } from '../conversation-service';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

// Mock dependencies
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    saveSessionMessages: vi.fn(),
    listSessionMessages: vi.fn(),
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

describe('conversation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveChatMessage', () => {
    it('should save a chat message successfully', async () => {
      (userDataApi.saveSessionMessages as any).mockResolvedValue({ messages: [] });

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Hello DM',
        speakerId: 'char-456',
      };

      await saveChatMessage(params);

      expect(userDataApi.saveSessionMessages).toHaveBeenCalledWith(
        params.sessionId,
        expect.objectContaining({
          speaker_type: params.role,
          message: params.content,
          speaker_id: params.speakerId,
        }),
      );
    });

    it('should use provided ID if available', async () => {
      (userDataApi.saveSessionMessages as any).mockResolvedValue({ messages: [] });

      const params = {
        sessionId: 'session-123',
        role: 'assistant' as const,
        content: 'Hello Player',
        id: 'custom-id',
      };

      await saveChatMessage(params);

      expect(userDataApi.saveSessionMessages).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          id: 'custom-id',
        }),
      );
    });

    it('should throw error and log when database save fails', async () => {
      (userDataApi.saveSessionMessages as any).mockRejectedValue(new Error('Database error'));

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Error test',
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
          sequence_number: 1,
        },
        {
          id: '2',
          speaker_type: 'assistant',
          message: 'Hi there',
          created_at: '2023-01-01T00:00:01Z',
          sequence_number: 2,
        },
      ];

      (userDataApi.listSessionMessages as any).mockResolvedValue({ messages: mockData, total: 2 });

      const history = await getConversationHistory('session-123');

      expect(userDataApi.listSessionMessages).toHaveBeenCalledWith('session-123', 0, 200);

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: new Date('2023-01-01T00:00:00Z'),
      });
      expect(history[1].role).toBe('assistant');
    });

    it('should handle missing created_at by using current date', async () => {
      const mockData = [
        {
          id: '1',
          speaker_type: 'user',
          message: 'Hello',
          created_at: null,
        },
      ];

      (userDataApi.listSessionMessages as any).mockResolvedValue({ messages: mockData, total: 1 });

      const history = await getConversationHistory('session-123');
      expect(history[0].timestamp).toBeInstanceOf(Date);
    });

    it('should throw error and log when retrieval fails', async () => {
      const mockError = new Error('Fetch error');
      (userDataApi.listSessionMessages as any).mockRejectedValue(mockError);

      await expect(getConversationHistory('session-123')).rejects.toThrow(
        'Failed to get conversation history',
      );
      expect(logger.error).toHaveBeenCalledWith('Error getting conversation history:', mockError);
    });
  });
});
