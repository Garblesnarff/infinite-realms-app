/**
 * OpportunityGenerator
 *
 * Generates immediate actions, nearby points of interest, and quest hooks
 * for the AI Dungeon Master based on the current campaign context and data
 * fetched from Supabase (e.g., available quests).
 *
 * Main Class:
 * - OpportunityGenerator: Creates contextual opportunities for players.
 *
 * Dependencies:
 * - Supabase client (`@/integrations/supabase/client`)
 * - CampaignContext type (from `@/types/dm`)
 *
 * @author AI Dungeon Master Team
 */

// External/SDK Imports
import { userDataApi } from '@/services/user-data-api';

// Project Types
import { CampaignContext } from '@/types/dm';
import { logger } from '../../../lib/logger';

export class OpportunityGenerator {
  async generateOpportunities(campaignId: string, context: CampaignContext) {
    const quests = await userDataApi.listQuests(campaignId, 'available').catch((error) => {
      logger.error('Error fetching quests:', error);
      return [];
    });

    return {
      immediate: this.generateImmediateActions(context.setting),
      // Ensure thematicElements and keyLocations exist and are arrays
      nearby: context.thematicElements?.keyLocations?.slice(0, 3) || [],
      questHooks: quests?.map((quest) => quest.title as string) || [], // Cast title as string
    };
  }

  private generateImmediateActions(setting: CampaignContext['setting'] | undefined): string[] {
    const actions: string[] = ['Look around more closely.', 'Consider your next move carefully.']; // Default actions

    if (setting?.atmosphere?.toLowerCase().includes('dangerous')) {
      actions.push('Stay alert and watch for threats.');
    }
    if (setting?.atmosphere?.toLowerCase().includes('mysterious')) {
      actions.push('Try to uncover a hidden detail.');
    }
    if (
      setting?.location?.toLowerCase().includes('tavern') ||
      setting?.location?.toLowerCase().includes('inn')
    ) {
      actions.push('Listen to any nearby conversations.');
      actions.push('Ask the barkeep for rumors.');
    }

    return actions;
  }
}
