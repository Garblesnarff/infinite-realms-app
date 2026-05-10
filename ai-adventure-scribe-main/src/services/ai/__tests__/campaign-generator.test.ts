/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateCampaignDescription, generateCampaignName } from '../campaign-generator';

// Mock the logger to avoid console output during tests
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the LLM API client
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
  },
}));

// Mock the prompts
vi.mock('../shared/prompts', () => ({
  buildCampaignDescriptionPrompt: vi.fn().mockReturnValue('Mock Description Prompt'),
  buildCampaignNamePrompt: vi.fn().mockReturnValue('Mock Name Prompt'),
}));

import { llmApiClient } from '@/infrastructure/api';

describe('Campaign Generator', () => {
  const mockParams = {
    genre: 'Fantasy',
    difficulty: 'Medium',
    length: 'Long',
    tone: 'Epic',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateCampaignDescription', () => {
    it('should generate a campaign description successfully', async () => {
      const mockDescription = 'In a land of dragons and magic...';
      (llmApiClient.generateText as any).mockResolvedValue(mockDescription);

      const result = await generateCampaignDescription(mockParams);

      expect(result).toBe(mockDescription);
      expect(llmApiClient.generateText).toHaveBeenCalledWith({
        prompt: 'Mock Description Prompt',
        temperature: 0.9,
        maxTokens: 2048,
      });
    });

    it('should throw an error when generation fails', async () => {
      (llmApiClient.generateText as any).mockRejectedValue(new Error('AI failure'));

      await expect(generateCampaignDescription(mockParams)).rejects.toThrow(
        'Failed to generate campaign description - AI service unavailable'
      );
    });
  });

  describe('generateCampaignName', () => {
    it('should generate and clean a campaign name successfully', async () => {
      const mockName = '  "The Dragon\'s Hoard"  ';
      (llmApiClient.generateText as any).mockResolvedValue(mockName);

      const result = await generateCampaignName(mockParams);

      expect(result).toBe("The Dragon's Hoard");
      expect(llmApiClient.generateText).toHaveBeenCalledWith({
        prompt: 'Mock Name Prompt',
        temperature: 0.9,
        maxTokens: 256,
      });
    });

    it('should handle single quotes for cleaning', async () => {
      const mockName = "'Shadow over Mistral'";
      (llmApiClient.generateText as any).mockResolvedValue(mockName);

      const result = await generateCampaignName(mockParams);

      expect(result).toBe("Shadow over Mistral");
    });

    it('should throw an error when generation fails', async () => {
      (llmApiClient.generateText as any).mockRejectedValue(new Error('AI failure'));

      await expect(generateCampaignName(mockParams)).rejects.toThrow(
        'Failed to generate campaign name - AI service unavailable'
      );
    });
  });
});
