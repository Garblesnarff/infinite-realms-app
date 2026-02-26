/**
 * Hook for fetching starter character templates
 *
 * Provides access to pre-built character templates for starter campaigns.
 * These templates allow users to quickly start playing with pre-made characters
 * that are adapted to fit each campaign's theme and setting.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StarterCharacterTemplate {
  id: string;
  starterCampaignId: string;
  templateKey: string;
  name: string;
  tagline: string | null;
  race: string;
  subrace: string | null;
  class: string;
  background: string | null;
  level: number;
  abilityScores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  personality: {
    traits?: string[];
    ideals?: string[];
    bonds?: string[];
    flaws?: string[];
  };
  skills: string[];
  languages: string[];
  equipment: string[];
  adaptedBackstory: string | null;
  campaignHook: string | null;
  portraitUrl: string | null;
  portraitPrompt: string | null;
  displayOrder: number;
}

interface UseStarterCharacterTemplatesResult {
  templates: StarterCharacterTemplate[];
  isLoading: boolean;
  error: Error | null;
}

/**
 * Map database row to StarterCharacterTemplate interface
 */
function mapTemplateRow(row: Record<string, unknown>): StarterCharacterTemplate {
  const abilityScores = (row.ability_scores as Record<string, number>) || {};
  const personality = (row.personality as Record<string, string[]>) || {};

  return {
    id: row.id as string,
    starterCampaignId: row.starter_campaign_id as string,
    templateKey: row.template_key as string,
    name: row.name as string,
    tagline: row.tagline as string | null,
    race: row.race as string,
    subrace: row.subrace as string | null,
    class: row.class as string,
    background: row.background as string | null,
    level: (row.level as number) || 1,
    abilityScores: {
      strength: abilityScores.strength || 10,
      dexterity: abilityScores.dexterity || 10,
      constitution: abilityScores.constitution || 10,
      intelligence: abilityScores.intelligence || 10,
      wisdom: abilityScores.wisdom || 10,
      charisma: abilityScores.charisma || 10,
    },
    personality: {
      traits: personality.traits || [],
      ideals: personality.ideals || [],
      bonds: personality.bonds || [],
      flaws: personality.flaws || [],
    },
    skills: (row.skills as string[]) || [],
    languages: (row.languages as string[]) || [],
    equipment: (row.equipment as string[]) || [],
    adaptedBackstory: row.adapted_backstory as string | null,
    campaignHook: row.campaign_hook as string | null,
    portraitUrl: row.portrait_url as string | null,
    portraitPrompt: row.portrait_prompt as string | null,
    displayOrder: (row.display_order as number) || 0,
  };
}

/**
 * Fetch character templates for a specific starter campaign
 *
 * @param campaignId - The starter campaign ID (e.g., 'abyssal-descent')
 * @returns Object containing templates array, loading state, and error
 */
export function useStarterCharacterTemplates(
  campaignId: string | undefined,
): UseStarterCharacterTemplatesResult {
  const [templates, setTemplates] = useState<StarterCharacterTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!campaignId) {
      setTemplates([]);
      setIsLoading(false);
      return;
    }

    async function fetchTemplates() {
      try {
        const { data, error: queryError } = await supabase
          .from('starter_character_templates')
          .select('*')
          .eq('starter_campaign_id', campaignId)
          .order('display_order');

        if (queryError) {
          throw new Error(queryError.message);
        }

        const mapped = (data || []).map(mapTemplateRow);
        setTemplates(mapped);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch character templates'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchTemplates();
  }, [campaignId]);

  return { templates, isLoading, error };
}

/**
 * Fetch a single character template by ID
 *
 * @param templateId - The UUID of the template
 * @returns Object containing template, loading state, and error
 */
export function useStarterCharacterTemplate(templateId: string | undefined): {
  template: StarterCharacterTemplate | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [template, setTemplate] = useState<StarterCharacterTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!templateId) {
      setTemplate(null);
      setIsLoading(false);
      return;
    }

    async function fetchTemplate() {
      try {
        const { data, error: queryError } = await supabase
          .from('starter_character_templates')
          .select('*')
          .eq('id', templateId)
          .single();

        if (queryError) {
          if (queryError.code === 'PGRST116') {
            setTemplate(null);
          } else {
            throw new Error(queryError.message);
          }
        } else {
          setTemplate(mapTemplateRow(data));
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch character template'));
      } finally {
        setIsLoading(false);
      }
    }

    fetchTemplate();
  }, [templateId]);

  return { template, isLoading, error };
}
