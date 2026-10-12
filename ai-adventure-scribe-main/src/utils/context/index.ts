import { gameContextBuilder } from './builder';

export { gameContextBuilder } from './builder';
export { createDefaultContext } from './contextDefaults';
export {
  buildEnhancedGameContext,
  enhanceCampaignContext,
  enhanceMemoryContext,
} from './contextEnhancement';
export {
  sortMemoriesByRelevance,
  validateCampaignSetting,
  validateGameContext,
  validateThematicElements,
} from './contextValidation';

/**
 * Builds complete game context by combining campaign, character, and memory data
 * @param campaignId - UUID of the campaign
 * @param characterId - UUID of the character
 * @param sessionId - UUID of the game session
 * @returns Combined context object
 */
export const buildGameContext = async (
  campaignId: string,
  characterId: string,
  sessionId: string,
) => {
  return gameContextBuilder.build({ campaignId, characterId, sessionId });
};
