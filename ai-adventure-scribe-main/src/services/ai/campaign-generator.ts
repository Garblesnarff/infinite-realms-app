/**
 * Campaign Generation Service
 *
 * Handles AI-powered campaign name and description generation using llmApiClient.
 * Extracted from ai-service.ts to maintain single responsibility.
 *
 * @module campaign-generator
 */

import { buildCampaignDescriptionPrompt, buildCampaignNamePrompt } from './shared/prompts';
import { llmApiClient } from '@/services/llm-api-client';

import type { CampaignParams } from './shared/types';

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
  logger.info('Using llmApiClient for campaign description...');

  try {
    const prompt = buildCampaignDescriptionPrompt(params);
    const result = await llmApiClient.generateText({
      prompt,
      temperature: 0.9,
      maxTokens: 2048,
    });

    logger.info('Successfully generated campaign description');
    return result;
  } catch (error) {
    logger.error('Campaign description generation failed:', error);
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
  logger.info('Using llmApiClient for campaign name...');

  try {
    const prompt = buildCampaignNamePrompt(params);
    const result = await llmApiClient.generateText({
      prompt,
      temperature: 0.9,
      maxTokens: 256,
    });

    // Clean up the result - remove quotes, extra whitespace, etc.
    const cleanedName = result
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();

    logger.info('Successfully generated campaign name:', cleanedName);
    return cleanedName;
  } catch (error) {
    logger.error('Campaign name generation failed:', error);
    throw new Error('Failed to generate campaign name - AI service unavailable');
  }
}
