/**
 * Character Description Generator Service
 *
 * Generates and enhances character descriptions using AI to create rich, detailed
 * character backgrounds, personality traits, and physical appearances for D&D characters.
 *
 * @author AI Dungeon Master Team
 */

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { parseDescriptionResponse } from '@/services/ai/character-description-parser';
import {
  CharacterDescriptionPrompts,
  type CharacterData,
  type DescriptionOptions,
  type EnhancedDescription,
} from '@/services/ai/prompts/character-description-prompts';

/**
 * Service class for generating and enhancing character descriptions
 */
export class CharacterDescriptionGenerator {
  /**
   * Generate or enhance a character description using AI
   * @param characterData - Character data to base the description on
   * @param options - Generation options
   * @returns Promise resolving to enhanced description data
   */
  async generateDescription(
    characterData: CharacterData,
    options: DescriptionOptions = {},
  ): Promise<EnhancedDescription> {
    try {
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(characterData, options);
      logger.info('Generating character description...');

      const response = await llmApiClient.generateText({
        prompt,
        maxTokens: 1000,
        temperature: 0.8,
      });

      logger.debug('Raw LLM response:', response);
      logger.debug('Response type:', typeof response);
      logger.debug('Response length:', response.length);

      if (!response || response.trim() === '') {
        logger.warn('Empty or null response from AI service');
        throw new Error('Received empty response from AI service');
      }

      const enhancedDescription = parseDescriptionResponse(response, characterData);

      logger.info('Successfully generated character description');
      return enhancedDescription;
    } catch (error) {
      logger.error('Failed to generate character description:', error);

      // Return static fallback description
      return {
        description:
          characterData.description ||
          `${characterData.name || 'The character'} is a ${characterData.race || 'heroic'} ${characterData.class || 'adventurer'}.`,
        appearance: `A typical ${characterData.race || 'adventurer'} with ${characterData.class || 'heroic'} characteristics.`,
        personality_traits: 'Determined and adventurous, with a strong sense of justice.',
        backstory_elements: `${characterData.name || 'This character'} comes from a ${characterData.background || 'common'} background and has chosen the path of a ${characterData.class || 'heroic adventurer'}.`,
      };
    }
  }

  /**
   * Generate a quick description for immediate use
   * @param characterData - Character data
   * @returns Simple description string
   */
  async generateQuickDescription(characterData: CharacterData): Promise<string> {
    try {
      const prompt = CharacterDescriptionPrompts.buildQuickDescriptionPrompt(characterData);

      const response = await llmApiClient.generateText({
        prompt,
        maxTokens: 100,
        temperature: 0.7,
      });

      return response.trim();
    } catch (error) {
      logger.error('Failed to generate quick description:', error);
      return `${characterData.name || 'This character'} is a ${characterData.race || 'heroic'} ${characterData.class || 'adventurer'} ready for adventure.`;
    }
  }
}

// Export singleton instance
export const characterDescriptionGenerator = new CharacterDescriptionGenerator();
