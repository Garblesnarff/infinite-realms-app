/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useChatHistory } from '../use-chat-history';

import { AIService } from '@/services/ai-service';
import { useChatPersistence } from '../use-chat-persistence';

// Mock dependencies
vi.mock('../use-chat-persistence', () => ({
  useChatPersistence: vi.fn(),
}));

vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
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

vi.mock('@/utils/error-handler', () => ({
  handleAsyncError: vi.fn(),
}));

describe('useChatHistory', () => {
  const mockSessionId = 'test-session-id';
  const mockCampaignId = 'test-campaign-id';
  const mockCharacterId = 'test-character-id';

  const mockPersistence = {
    messages: [],
    setMessages: vi.fn(),
    isLoadingHistory: false,
    hasLoadedHistory: false,
    setHasLoadedHistory: vi.fn(),
    saveMessageToDatabase: vi.fn().mockResolvedValue(true),
    fetchHistory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useChatPersistence as any).mockReturnValue(mockPersistence);
    mockPersistence.messages = [];
    mockPersistence.hasLoadedHistory = false;
  });

  describe('Initialization and History Loading', () => {
    it('should load history on mount if sessionId is present', async () => {
      const mockHistory = [
        { id: '1', role: 'assistant', content: 'Opening', timestamp: new Date() },
      ];
      mockPersistence.fetchHistory.mockResolvedValue(mockHistory);

      renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await waitFor(() => {
        expect(mockPersistence.fetchHistory).toHaveBeenCalled();
        expect(mockPersistence.setMessages).toHaveBeenCalledWith(mockHistory);
        expect(mockPersistence.setHasLoadedHistory).toHaveBeenCalledWith(true);
      });
    });

    it('should generate opening message if history is empty', async () => {
      mockPersistence.fetchHistory.mockResolvedValue([]);
      const mockAIResponse = { text: 'Welcome!', narration_segments: [] };
      (AIService.chatWithDM as any).mockResolvedValue(mockAIResponse);

      renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await waitFor(() => {
        expect(AIService.chatWithDM).toHaveBeenCalled();
        expect(mockPersistence.setMessages).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({ content: 'Welcome!', role: 'assistant' })
        ]));
      });
    });

    it('should generate opening message if fetchHistory returns null (error)', async () => {
      mockPersistence.fetchHistory.mockResolvedValue(null);
      const mockAIResponse = 'Error fallback opening';
      (AIService.chatWithDM as any).mockResolvedValue(mockAIResponse);

      renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await waitFor(() => {
        expect(AIService.chatWithDM).toHaveBeenCalled();
        expect(mockPersistence.setHasLoadedHistory).toHaveBeenCalledWith(true);
      });
    });

    it('should not load history if sessionId is missing', () => {
      renderHook(() => useChatHistory({
        sessionId: undefined,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      expect(mockPersistence.fetchHistory).not.toHaveBeenCalled();
    });
  });

  describe('generateOpeningMessage', () => {
    it('should handle string AI response', async () => {
      mockPersistence.fetchHistory.mockResolvedValue([]);
      (AIService.chatWithDM as any).mockResolvedValue('String response');

      renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await waitFor(() => {
        expect(mockPersistence.setMessages).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({ content: 'String response' })
        ]));
      });
    });

    it('should handle object AI response with content field', async () => {
      mockPersistence.fetchHistory.mockResolvedValue([]);
      (AIService.chatWithDM as any).mockResolvedValue({ content: 'Content response' });

      renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await waitFor(() => {
        expect(mockPersistence.setMessages).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({ content: 'Content response' })
        ]));
      });
    });

    it('should use fallback text if AI response is empty', async () => {
      mockPersistence.fetchHistory.mockResolvedValue([]);
      (AIService.chatWithDM as any).mockResolvedValue({ text: '' });

      renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await waitFor(() => {
        expect(mockPersistence.setMessages).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({ content: 'The DM begins your adventure...' })
        ]));
      });
    });

    it('should handle AI service error in generateOpeningMessage', async () => {
      mockPersistence.fetchHistory.mockResolvedValue([]);
      (AIService.chatWithDM as any).mockRejectedValue(new Error('AI Start Error'));

      renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await waitFor(() => {
        expect(AIService.chatWithDM).toHaveBeenCalled();
        // Should not have called setMessages with a DM message
        expect(mockPersistence.setMessages).not.toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({ role: 'assistant' })
        ]));
      });
    });
  });

  describe('sendMessage', () => {
    it('should send message successfully and update state', async () => {
      mockPersistence.hasLoadedHistory = true;
      const mockAIResponse = { text: 'DM Response', narration_segments: [{ text: 'Seg1' }] };
      (AIService.chatWithDM as any).mockResolvedValue(mockAIResponse);

      const { result } = renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await act(async () => {
        await result.current.sendMessage('Hello DM');
      });

      // User message
      expect(mockPersistence.setMessages).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ content: 'Hello DM', role: 'user' })
      ]));

      // DM message (via functional update)
      expect(mockPersistence.setMessages).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should handle AI service failure', async () => {
      mockPersistence.hasLoadedHistory = true;
      const initialMessages: any[] = [{ id: 'prev', role: 'assistant', content: 'Prev' }];
      mockPersistence.messages = initialMessages;
      (AIService.chatWithDM as any).mockRejectedValue(new Error('AI Failure'));

      const { result } = renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await act(async () => {
        await result.current.sendMessage('Fail me');
      });

      expect(mockPersistence.setMessages).toHaveBeenLastCalledWith(initialMessages);
    });

    it('should not add to state if saveMessageToDatabase fails for DM response', async () => {
      mockPersistence.hasLoadedHistory = true;
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'Success' });
      // First call for user message succeeds, second for DM fails
      mockPersistence.saveMessageToDatabase
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const { result } = renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await act(async () => {
        await result.current.sendMessage('Save fails');
      });

      // Should not have the DM message in state if save failed
      // The last call would be the one adding the user message or restoring initial state
      expect(mockPersistence.setMessages).not.toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ content: 'Success' })
      ]));
    });

    it('should use fallback text if DM response text is empty', async () => {
      mockPersistence.hasLoadedHistory = true;
      (AIService.chatWithDM as any).mockResolvedValue({ text: '  ' });
      mockPersistence.saveMessageToDatabase.mockResolvedValue(true);

      const { result } = renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await act(async () => {
        await result.current.sendMessage('Empty response');
      });

      expect(mockPersistence.saveMessageToDatabase).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'The DM responds to your action...' }),
        mockSessionId
      );
    });

    it('should handle missing sessionId when sending message', async () => {
      const { result } = renderHook(() => useChatHistory({
        sessionId: undefined,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await act(async () => {
        await result.current.sendMessage('Hello');
      });

      expect(AIService.chatWithDM).not.toHaveBeenCalled();
    });

    it('should handle empty or whitespace message content', async () => {
      mockPersistence.hasLoadedHistory = true; // Avoid initial generation

      const { result } = renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await act(async () => {
        await result.current.sendMessage('   ');
      });

      // The one call would be for initial generation if we didn't mock hasLoadedHistory correctly
      // But we want to ensure sendMessage itself didn't trigger another one.
      expect(AIService.chatWithDM).not.toHaveBeenCalled();
    });

    it('should handle failed user message save but continue', async () => {
      mockPersistence.hasLoadedHistory = true;
      mockPersistence.saveMessageToDatabase.mockResolvedValueOnce(false); // User message save fails
      (AIService.chatWithDM as any).mockResolvedValue('DM Success');

      const { result } = renderHook(() => useChatHistory({
        sessionId: mockSessionId,
        campaignId: mockCampaignId,
        characterId: mockCharacterId,
      }));

      await act(async () => {
        await result.current.sendMessage('User save fails');
      });

      expect(AIService.chatWithDM).toHaveBeenCalled();
    });
  });
});
