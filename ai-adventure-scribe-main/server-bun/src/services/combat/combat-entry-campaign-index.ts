import { emptyCampaignMonsterIndex, type CampaignMonsterIndex } from './campaign-monster-index.js';
import { logger } from '../../lib/logger.js';

/**
 * The authored creatures of the campaign a session was started from.
 *
 * Never throws: entry must not fail because the index could not be read, and an empty index only
 * means the creature has to be named some other way. Database imports stay inside the function so
 * the entry pipeline can be loaded without opening the database.
 */
export async function loadSessionCampaignMonsterIndex(
  sessionId: string,
  userId: string,
): Promise<CampaignMonsterIndex> {
  try {
    const [{ SessionService }, { loadCampaignMonsterIndex }] = await Promise.all([
      import('../session-service.js'),
      import('./campaign-monster-resolution.js'),
    ]);
    const session = await SessionService.getSessionById(sessionId, userId);
    return await loadCampaignMonsterIndex(session.starterCampaignId);
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENTRY_CAMPAIGN_INDEX_UNAVAILABLE', sessionId, error });
    return emptyCampaignMonsterIndex('');
  }
}
