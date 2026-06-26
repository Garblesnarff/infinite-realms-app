/**
 * MechanicsGenerator
 *
 * Generates game mechanics details for the AI Dungeon Master, including
 * available actions, relevant rules, and contextual suggestions.
 *
 * Main Class:
 * - MechanicsGenerator: Creates mechanics-related information for game responses.
 *
 * Dependencies:
 * - Supabase client (`@/integrations/supabase/client`)
 * - CampaignContext type (from `@/types/dm`)
 *
 * @author AI Dungeon Master Team
 */

// External/SDK Imports
import { logger } from '../../../lib/logger';

import type { CampaignContext } from '@/types/dm';

import { supabase } from '@/integrations/supabase/client';

// Project Types

export class MechanicsGenerator {
  async generateMechanics(context: CampaignContext): Promise<{
    availableActions: string[];
    relevantRules: string[];
    suggestions: string[];
  }> {
    return {
      availableActions: ['Move', 'Interact', 'Attack', 'Cast Spell'], // These could be dynamic later
      relevantRules: await this.getRulesForContext(),
      suggestions: this.generateActionSuggestions(context),
    };
  }

  private async getRulesForContext(): Promise<string[]> {
    const { data: rules, error } = await supabase
      .from('rule_validations') // Assuming this table exists and is relevant
      .select('rule_description')
      .eq('is_active', true) // Assuming a way to filter active/relevant rules
      .limit(3);

    if (error) {
      logger.error('Error fetching rules for context:', error);
      return ['Error fetching rules.'];
    }

    const mappedRules = rules?.map((rule) => rule.rule_description as string) || [];
    return mappedRules.length > 0
      ? mappedRules
      : ['No specific rules highlighted currently.'];
  }

  private generateActionSuggestions(context: CampaignContext): string[] {
    const suggestions: string[] = [];

    if (context.genre?.toLowerCase() === 'mystery') {
      suggestions.push('Search for hidden clues or inconsistencies.');
      suggestions.push('Interrogate a suspicious character.');
    }
    if (context.tone?.toLowerCase() === 'humorous') {
      suggestions.push('Try something unexpected or comical.');
      suggestions.push('Engage in witty banter.');
    }
    if (context.setting?.atmosphere?.toLowerCase().includes('tense')) {
      suggestions.push('Be cautious and observant.');
    }

    if (suggestions.length === 0) {
      suggestions.push("Consider your character's goals and surroundings.");
    }

    return suggestions;
  }
}
