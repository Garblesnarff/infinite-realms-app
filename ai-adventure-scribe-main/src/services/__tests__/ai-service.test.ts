/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateCampaignDescription, generateCampaignName } from '../ai/campaign-generator';
import { ContextBuilder } from '../ai/context-builder';
import { processDMResponse } from '../ai/dm-response-processor';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';

import { llmApiClient } from '@/infrastructure/api';
import { detectCombatFromText } from '@/utils/combatDetection';

// Mock dependencies
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
  },
}));

vi.mock('../memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn(),
    saveMemories: vi.fn(),
    extractMemories: vi.fn(),
  },
}));

vi.mock('../ai/context-builder', () => ({
  ContextBuilder: {
    build: vi.fn(),
  },
}));

vi.mock('../ai/dm-response-processor', () => ({
  processDMResponse: vi.fn(),
}));

vi.mock('@/utils/combatDetection', () => ({
  detectCombatFromText: vi.fn(),
}));

vi.mock('../ai/campaign-generator', () => ({
  generateCampaignDescription: vi.fn(),
  generateCampaignName: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateCampaignDescription', () => {
    it('should delegate to generateCampaignDescription utility', async () => {
      const params = { genre: 'Fantasy', difficulty: 'Hard', length: 'Long', tone: 'Serious' };
      vi.mocked(generateCampaignDescription).mockResolvedValue('Mock Description');

      const result = await AIService.generateCampaignDescription(params);

      expect(generateCampaignDescription).toHaveBeenCalledWith(params);
      expect(result).toBe('Mock Description');
    });
  });

  describe('generateCampaignName', () => {
    it('should delegate to generateCampaignName utility', async () => {
      const params = { genre: 'Sci-Fi', difficulty: 'Easy', length: 'Short', tone: 'Humorous' };
      vi.mocked(generateCampaignName).mockResolvedValue('Mock Name');

      const result = await AIService.generateCampaignName(params);

      expect(generateCampaignName).toHaveBeenCalledWith(params);
      expect(result).toBe('Mock Name');
    });
  });

  describe('chatWithDM', () => {
    const mockContext: any = { sessionId: 'session-123', campaignId: 'campaign-456' };

    it('should correctly orchestrate the chat flow', async () => {
      const mockParams: any = {
        message: 'Hello DM',
        context: mockContext,
        conversationHistory: [],
      };

      // Setup mocks
      const mockMemories = [{ content: 'memory 1' }];
      vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue(mockMemories as any);

      const mockCombatResult = expect.objectContaining({ isCombat: false, confidence: 1 });

      const mockPrompt = 'Build prompt';
      vi.mocked(ContextBuilder.build).mockResolvedValue(mockPrompt);

      vi.mocked(llmApiClient.generateText).mockResolvedValue('AI RAW Response');

      const mockProcessedResponse = { text: 'Processed Text' };
      vi.mocked(processDMResponse).mockResolvedValue(mockProcessedResponse as any);

      // Act
      const result = await AIService.chatWithDM(mockParams);

      // Assert
      expect(MemoryManager.getRelevantMemories).toHaveBeenCalledWith(
        mockContext.sessionId,
        'Hello DM',
        8,
      );
      expect(detectCombatFromText).not.toHaveBeenCalled();
      expect(ContextBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          context: mockContext,
          message: 'Hello DM',
          relevantMemories: mockMemories,
          combatDetection: mockCombatResult,
          isFirstMessage: false, // Message is not empty
        }),
      );
      expect(llmApiClient.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(mockPrompt),
        }),
      );
      expect(processDMResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          rawResponse: 'AI RAW Response',
          combatDetection: mockCombatResult,
        }),
      );
      expect(result).toEqual(mockProcessedResponse);
    });

    it('should use provided memories if available', async () => {
      const mockParams: any = {
        message: 'Message with memories',
        context: mockContext,
        conversationHistory: [],
      };
      const providedMemories = [{ content: 'provided memory' }];
      const paramsWithMemories = { ...mockParams, relevantMemories: providedMemories };

      vi.mocked(ContextBuilder.build).mockResolvedValue('prompt');
      vi.mocked(llmApiClient.generateText).mockResolvedValue('resp');
      vi.mocked(processDMResponse).mockResolvedValue({ text: 'ok' } as any);

      await AIService.chatWithDM(paramsWithMemories);

      expect(MemoryManager.getRelevantMemories).not.toHaveBeenCalled();
      expect(ContextBuilder.build).toHaveBeenCalledWith(
        expect.objectContaining({
          relevantMemories: providedMemories,
        }),
      );
    });

    it('should handle errors gracefully', async () => {
      const mockParams: any = {
        message: 'Error message',
        context: mockContext,
        conversationHistory: [],
      };
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('API Failure'));

      await expect(AIService.chatWithDM(mockParams)).rejects.toThrow(
        'Failed to get DM response - AI service unavailable',
      );
    });
  });

  describe('generateOpeningMessage', () => {
    it('should call chatWithDM with empty message and return text', async () => {
      const mockContext: any = { sessionId: '123-opening' };
      const spy = vi
        .spyOn(AIService, 'chatWithDM')
        .mockResolvedValue({ text: 'Opening scene' } as any);

      const result = await AIService.generateOpeningMessage({ context: mockContext });

      expect(spy).toHaveBeenCalledWith({
        message: '',
        context: mockContext,
        conversationHistory: [],
      });
      expect(result).toBe('Opening scene');
    });

    it('should handle string response from chatWithDM (legacy/fallback)', async () => {
      const mockContext: any = { sessionId: '123-legacy' };
      vi.spyOn(AIService, 'chatWithDM').mockResolvedValue('Opening scene' as any);

      const result = await AIService.generateOpeningMessage({ context: mockContext });

      expect(result).toBe('Opening scene');
    });
  });
});
