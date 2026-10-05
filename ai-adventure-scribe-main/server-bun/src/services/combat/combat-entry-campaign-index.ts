import { eq } from 'drizzle-orm';

import { emptyCampaignMonsterIndex, type CampaignMonsterIndex } from './campaign-monster-index.js';
import {
  normalizeEncounterDifficulty,
  type EncounterContext,
} from './encounter-sizing.js';
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
  const context = await loadSessionEncounterContext(sessionId, userId);
  return context.index;
}

/**
 * The encounter-sizing context for a session: its campaign difficulty and
 * its authored-creature index (#2514).
 *
 * Difficulty comes from the starter campaign row when the session was
 * started from one (`starter_campaigns.difficulty`, the enum the beta
 * campaigns carry), otherwise from the user campaign row
 * (`campaigns.difficulty_level`). Either may be absent; then sizing is a
 * no-op (1 creature, as before #2514).
 *
 * Never throws, for the same reason as the index loader above: a failed
 * difficulty read must not take combat entry down with it.
 */
export async function loadSessionEncounterContext(
  sessionId: string,
  userId: string,
): Promise<EncounterContext> {
  try {
    const [{ SessionService }, { loadCampaignMonsterIndex }] = await Promise.all([
      import('../session-service.js'),
      import('./campaign-monster-resolution.js'),
    ]);
    const session = await SessionService.getSessionById(sessionId, userId);
    const index = await loadCampaignMonsterIndex(session.starterCampaignId);

    let difficultyRaw: string | null = null;
    try {
      const [{ db }, schema] = await Promise.all([
        import('../../../../db/client.js'),
        import('../../../../db/schema/index.js'),
      ]);
      if (session.starterCampaignId) {
        const [row] = await db
          .select({ difficulty: schema.starterCampaigns.difficulty })
          .from(schema.starterCampaigns)
          .where(eq(schema.starterCampaigns.id, session.starterCampaignId))
          .limit(1);
        difficultyRaw = row?.difficulty ?? null;
      }
      if (!difficultyRaw && session.campaignId) {
        const [row] = await db
          .select({ difficultyLevel: schema.campaigns.difficultyLevel })
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, session.campaignId))
          .limit(1);
        difficultyRaw = row?.difficultyLevel ?? null;
      }
    } catch (difficultyError) {
      logger.warn({
        msg: 'COMBAT_ENTRY_CAMPAIGN_DIFFICULTY_UNAVAILABLE',
        sessionId,
        error: difficultyError,
      });
    }

    return { difficulty: normalizeEncounterDifficulty(difficultyRaw), difficultyRaw, index };
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENTRY_CAMPAIGN_INDEX_UNAVAILABLE', sessionId, error });
    return { difficulty: null, difficultyRaw: null, index: emptyCampaignMonsterIndex('') };
  }
}
