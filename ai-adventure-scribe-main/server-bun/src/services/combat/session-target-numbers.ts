import { showTargetNumbersByDefault } from '../../../../shared/show-target-numbers.js';
import { logger } from '../../lib/logger.js';

/**
 * Whether the engine may word this session's spell outcomes against their target
 * numbers ("vs AC 12", "vs DC 13") in the facts it hands the DM.
 *
 * The client gates those numbers behind the player's "Show target numbers" choice,
 * but the server cannot see that local toggle. All it can follow is the campaign's
 * difficulty, through the one shared rule the client default also uses — so on a
 * Hard campaign the DM is never told the number it would otherwise say out loud.
 *
 * Never throws: narration must not fail because the setting could not be read. An
 * unreadable setting falls back to the shared rule for an unknown difficulty
 * (numbers shown), which is the behavior every campaign had before this gate.
 * Database imports stay inside the function so this module loads without opening
 * the application database.
 */
export async function showTargetNumbersForSession(sessionId: string): Promise<boolean> {
  try {
    const [{ db }, { campaigns, gameSessions, starterCampaigns }, { eq }] = await Promise.all([
      import('../../../../db/client.js'),
      import('../../../../db/schema/index.js'),
      import('drizzle-orm'),
    ]);
    const [session] = await db
      .select({
        campaignId: gameSessions.campaignId,
        starterCampaignId: gameSessions.starterCampaignId,
      })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .limit(1);
    if (session?.campaignId) {
      const [campaign] = await db
        .select({ difficultyLevel: campaigns.difficultyLevel })
        .from(campaigns)
        .where(eq(campaigns.id, session.campaignId))
        .limit(1);
      return showTargetNumbersByDefault(campaign?.difficultyLevel);
    }
    if (session?.starterCampaignId) {
      const [starter] = await db
        .select({ difficulty: starterCampaigns.difficulty })
        .from(starterCampaigns)
        .where(eq(starterCampaigns.id, session.starterCampaignId))
        .limit(1);
      return showTargetNumbersByDefault(starter?.difficulty);
    }
    return showTargetNumbersByDefault(undefined);
  } catch (error) {
    logger.warn({ msg: 'SESSION_TARGET_NUMBERS_UNAVAILABLE', sessionId, error });
    return true;
  }
}
