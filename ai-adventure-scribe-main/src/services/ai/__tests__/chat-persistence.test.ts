/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChatPersistence } from '../chat-persistence';

import { userDataApi } from '@/services/user-data-api';
import logger from '@/lib/logger';

// ChatPersistence was migrated from direct supabase.from('dialogue_history') calls to
// userDataApi (the Bun server's REST API client) - see src/services/ai/chat-persistence.ts.
// Both saveChatMessage() and getConversationHistory() now rethrow whatever error
// userDataApi throws verbatim (no "Failed to save/get ..." wrapping message), so the
// mocks and error-message assertions below were updated to match.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    saveSessionMessages: vi.fn(),
    listSessionMessages: vi.fn(),
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
      vi.mocked(userDataApi.saveSessionMessages).mockResolvedValue({});

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Hello world',
        speakerId: 'speaker-456',
        id: 'msg-789',
      };

      await ChatPersistence.saveChatMessage(params);

      expect(userDataApi.saveSessionMessages).toHaveBeenCalledWith('session-123', {
        id: 'msg-789',
        speaker_type: 'user',
        speaker_id: 'speaker-456',
        message: 'Hello world',
      });
    });

    it('should generate a UUID if no id is provided', async () => {
      vi.mocked(userDataApi.saveSessionMessages).mockResolvedValue({});

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

      expect(userDataApi.saveSessionMessages).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          id: 'random-uuid',
        }),
      );
    });

    it('should throw an error and log it if saving fails', async () => {
      const mockError = new Error('Insert failed');
      vi.mocked(userDataApi.saveSessionMessages).mockRejectedValue(mockError);

      const params = {
        sessionId: 'session-123',
        role: 'user' as const,
        content: 'Hello',
      };

      // saveChatMessage() rethrows whatever userDataApi.saveSessionMessages() throws
      // verbatim - there's no "Failed to save chat message" wrapper anymore.
      await expect(ChatPersistence.saveChatMessage(params)).rejects.toThrow('Insert failed');
      expect(logger.error).toHaveBeenCalledWith('Error saving chat message:', mockError);
    });

    it('should catch and log unexpected errors', async () => {
      const unexpectedError = new Error('Unexpected');
      vi.mocked(userDataApi.saveSessionMessages).mockRejectedValue(unexpectedError);

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

      vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
        messages: mockData as any,
        total: mockData.length,
        hasMore: false,
      });

      const history = await ChatPersistence.getConversationHistory('session-123');

      expect(userDataApi.listSessionMessages).toHaveBeenCalledWith('session-123', 0, 200);

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

      vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
        messages: mockData as any,
        total: mockData.length,
        hasMore: false,
      });

      const now = new Date('2023-05-05T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const history = await ChatPersistence.getConversationHistory('session-123');

      expect(history[0].timestamp).toEqual(now);
    });

    it('should throw and log error if the request fails', async () => {
      const mockError = new Error('Fetch failed');
      vi.mocked(userDataApi.listSessionMessages).mockRejectedValue(mockError);

      // getConversationHistory() rethrows verbatim - there's no "Failed to get
      // conversation history" wrapper anymore.
      await expect(ChatPersistence.getConversationHistory('session-123')).rejects.toThrow(
        'Fetch failed',
      );
      expect(logger.error).toHaveBeenCalledWith('Error getting conversation history:', mockError);
    });

    it('should catch and log unexpected errors during fetch', async () => {
      const unexpectedError = new Error('Unexpected');
      vi.mocked(userDataApi.listSessionMessages).mockRejectedValue(unexpectedError);

      await expect(ChatPersistence.getConversationHistory('session-123')).rejects.toThrow(
        unexpectedError,
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Error getting conversation history:',
        unexpectedError,
      );
    });
  });
});
