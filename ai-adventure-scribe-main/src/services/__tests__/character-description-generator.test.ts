/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { characterDescriptionGenerator } from '../character-description-generator';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { parseDescriptionResponse } from '@/services/ai/character-description-parser';
import { CharacterDescriptionPrompts } from '@/services/ai/prompts/character-description-prompts';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/ai/character-description-parser', () => ({
  parseDescriptionResponse: vi.fn(),
}));

vi.mock('@/services/ai/prompts/character-description-prompts', () => ({
  CharacterDescriptionPrompts: {
    buildDescriptionPrompt: vi.fn(),
    buildQuickDescriptionPrompt: vi.fn(),
  },
}));

describe('CharacterDescriptionGenerator', () => {
  const mockCharacterData: any = {
    name: 'Grog',
    race: 'Goliath',
    class: 'Barbarian',
    background: 'Outlander',
    description: 'A large barbarian',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateDescription', () => {
    it('should successfully generate and parse a description', async () => {
      const mockPrompt = 'Mock Prompt';
      const mockResponse = 'Mock AI Response';
      const mockEnhancedDescription = {
        description: 'Enhanced description',
        appearance: 'Enhanced appearance',
        personality_traits: 'Enhanced personality',
        backstory_elements: 'Enhanced backstory',
      };

      vi.mocked(CharacterDescriptionPrompts.buildDescriptionPrompt).mockReturnValue(mockPrompt);
      vi.mocked(llmApiClient.generateText).mockResolvedValue(mockResponse);
      vi.mocked(parseDescriptionResponse).mockReturnValue(mockEnhancedDescription);

      const result = await characterDescriptionGenerator.generateDescription(mockCharacterData);

      expect(CharacterDescriptionPrompts.buildDescriptionPrompt).toHaveBeenCalledWith(mockCharacterData, {});
      expect(llmApiClient.generateText).toHaveBeenCalledWith({
        prompt: mockPrompt,
        maxTokens: 1000,
        temperature: 0.8,
      });
      expect(parseDescriptionResponse).toHaveBeenCalledWith(mockResponse, mockCharacterData);
      expect(result).toEqual(mockEnhancedDescription);
      expect(logger.info).toHaveBeenCalledWith('Successfully generated character description');
    });

    it('should handle empty response and return fallback', async () => {
      vi.mocked(CharacterDescriptionPrompts.buildDescriptionPrompt).mockReturnValue('prompt');
      vi.mocked(llmApiClient.generateText).mockResolvedValue('');

      const result = await characterDescriptionGenerator.generateDescription(mockCharacterData);

      expect(logger.warn).toHaveBeenCalledWith('Empty or null response from AI service');
      expect(logger.error).toHaveBeenCalledWith('Failed to generate character description:', expect.any(Error));
      expect(result.description).toBe(mockCharacterData.description);
      expect(result.appearance).toContain('Goliath');
    });

    it('should return fallback if API call fails', async () => {
      vi.mocked(CharacterDescriptionPrompts.buildDescriptionPrompt).mockReturnValue('prompt');
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('API Error'));

      const result = await characterDescriptionGenerator.generateDescription(mockCharacterData);

      expect(logger.error).toHaveBeenCalledWith('Failed to generate character description:', expect.any(Error));
      expect(result.description).toBe(mockCharacterData.description);
    });

    it('should use character info in fallback if description is missing', async () => {
      const dataWithoutDesc = { ...mockCharacterData, description: null };
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('Fail'));

      const result = await characterDescriptionGenerator.generateDescription(dataWithoutDesc);

      expect(result.description).toContain('Grog');
      expect(result.description).toContain('Goliath');
      expect(result.description).toContain('Barbarian');
    });

    it('should handle fallback when name, race, class, or background are missing', async () => {
      const bareCharacter: any = { name: null, race: null, class: null, background: null };
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('API Error'));

      const result = await characterDescriptionGenerator.generateDescription(bareCharacter);

      expect(result.description).toContain('The character');
      expect(result.description).toContain('heroic');
      expect(result.description).toContain('adventurer');
      expect(result.appearance).toContain('typical');
      expect(result.backstory_elements).toContain('This character');
      expect(result.backstory_elements).toContain('common');
    });
  });

  describe('generateQuickDescription', () => {
    it('should successfully generate a quick description', async () => {
      const mockPrompt = 'Quick Prompt';
      const mockResponse = '  Brief description  ';
      vi.mocked(CharacterDescriptionPrompts.buildQuickDescriptionPrompt).mockReturnValue(mockPrompt);
      vi.mocked(llmApiClient.generateText).mockResolvedValue(mockResponse);

      const result = await characterDescriptionGenerator.generateQuickDescription(mockCharacterData);

      expect(CharacterDescriptionPrompts.buildQuickDescriptionPrompt).toHaveBeenCalledWith(mockCharacterData);
      expect(llmApiClient.generateText).toHaveBeenCalledWith({
        prompt: mockPrompt,
        maxTokens: 100,
        temperature: 0.7,
      });
      expect(result).toBe('Brief description');
    });

    it('should return fallback if quick description API call fails', async () => {
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('API Error'));

      const result = await characterDescriptionGenerator.generateQuickDescription(mockCharacterData);

      expect(logger.error).toHaveBeenCalledWith('Failed to generate quick description:', expect.any(Error));
      expect(result).toContain('Grog');
      expect(result).toContain('Goliath');
      expect(result).toContain('Barbarian');
    });

    it('should handle quick description fallback when name, race, or class are missing', async () => {
      const bareCharacter: any = { name: null, race: null, class: null };
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('API Error'));

      const result = await characterDescriptionGenerator.generateQuickDescription(bareCharacter);

      expect(result).toContain('This character');
      expect(result).toContain('heroic');
      expect(result).toContain('adventurer');
    });
  });
});
