/**
 * Campaign Generation Service
 *
 * Handles AI-powered campaign name and description generation using Gemini API.
 * Extracted from ai-service.ts to maintain single responsibility.
 *
 * @module campaign-generator
 */

import { buildCampaignDescriptionPrompt, buildCampaignNamePrompt } from './shared/prompts';
import { getGeminiManager } from './shared/utils';

import type { CampaignParams } from './shared/types';

import { GEMINI_TEXT_MODEL } from '@/config/ai';
import logger from '@/lib/logger';

/**
 * Generate a campaign description using AI
 *
 * Creates an engaging D&D 5e campaign description that hooks players
 * immediately and sets up an epic adventure based on provided parameters.
 *
 * @param params - Campaign generation parameters (genre, difficulty, length, tone)
 * @returns Generated campaign description text
 * @throws Error if AI service is unavailable
 *
 * @example
 * ```typescript
 * const description = await generateCampaignDescription({
 *   genre: 'Fantasy',
 *   difficulty: 'Medium',
 *   length: 'Long',
 *   tone: 'dark'
 * });
 * ```
 */
export async function generateCampaignDescription(params: CampaignParams): Promise<string> {
  logger.info('Using local Gemini API for campaign description...');

  try {
    const geminiManager = getGeminiManager();

    const result = await geminiManager.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });
      const prompt = buildCampaignDescriptionPrompt(params);

      const response = await model.generateContent(prompt);
      const result = await response.response;
      return result.text();
    });

    logger.info('Successfully generated campaign description using local Gemini API');
    return result;
  } catch (geminiError) {
    logger.error('Local Gemini API failed:', geminiError);
    throw new Error('Failed to generate campaign description - AI service unavailable');
  }
}

/**
 * Generate a campaign name using AI
 *
 * Creates an evocative, memorable campaign name based on the provided parameters.
 *
 * @param params - Campaign generation parameters (genre, difficulty, length, tone)
 * @returns Generated campaign name
 * @throws Error if AI service is unavailable
 *
 * @example
 * ```typescript
 * const name = await generateCampaignName({
 *   genre: 'Fantasy',
 *   difficulty: 'Medium',
 *   length: 'Long',
 *   tone: 'dark'
 * });
 * // Returns something like "The Shattered Crown" or "Grim Harvest"
 * ```
 */
export async function generateCampaignName(params: CampaignParams): Promise<string> {
  logger.info('Using local Gemini API for campaign name...');

  try {
    const geminiManager = getGeminiManager();

    const result = await geminiManager.executeWithRotation(async (genAI) => {
      const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });
      const prompt = buildCampaignNamePrompt(params);

      const response = await model.generateContent(prompt);
      const result = await response.response;
      return result.text();
    });

    // Clean up the result - remove quotes, extra whitespace, etc.
    const cleanedName = result.trim().replace(/^["']|["']$/g, '').trim();

    logger.info('Successfully generated campaign name using local Gemini API:', cleanedName);
    return cleanedName;
  } catch (geminiError) {
    logger.error('Local Gemini API failed:', geminiError);
    throw new Error('Failed to generate campaign name - AI service unavailable');
  }
}
