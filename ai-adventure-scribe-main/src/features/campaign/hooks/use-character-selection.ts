import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export interface Character {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  avatar_url?: string | null;
  background_image?: string | null;
  character_stats?: {
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
    armor_class?: number;
    max_hit_points?: number;
  };
}

export interface StarterTemplate {
  id: string;
  starter_campaign_id: string;
  template_key: string;
  name: string;
  tagline: string | null;
  race: string;
  subrace: string | null;
  class: string;
  background: string | null;
  level: number;
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  personality: Record<string, string[]>;
  skills: string[];
  languages: string[];
  equipment: string[];
  adapted_backstory: string | null;
  campaign_hook: string | null;
  portrait_url: string | null;
  portrait_prompt: string | null;
  display_order: number;
}

interface UseCharacterSelectionProps {
  campaignId: string;
  campaignName: string;
  onClose: () => void;
  isOpen: boolean;
}

/**
 * useCharacterSelection Hook
 *
 * Extracted logic for character selection and creation.
 */
export function useCharacterSelection({
  campaignId,
  campaignName,
  onClose,
  isOpen,
}: UseCharacterSelectionProps): {
  isLoading: boolean;
  isStarterCampaign: boolean;
  templates: StarterTemplate[] | undefined;
  characters: Character[] | undefined;
  isCreating: boolean;
  handleSelectTemplate: (template: StarterTemplate) => Promise<void>;
  startGameWithCharacter: (character: Character) => void;
  handleCreateCharacter: () => void;
} {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isCreating, setIsCreating] = useState(false);

  // Check if this campaign is linked to a starter campaign
  const { data: starterCampaignId, isLoading: starterLoading } = useQuery({
    queryKey: ['campaign', campaignId, 'starterLink'],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await supabase
        .from('game_sessions')
        .select('starter_campaign_id')
        .eq('campaign_id', campaignId)
        .not('starter_campaign_id', 'is', null)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error checking starter campaign link:', error);
        return null;
      }

      return data?.starter_campaign_id || null;
    },
    enabled: !!user?.id && isOpen,
  });

  // Fetch starter character templates (only when linked to starter campaign)
  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['starterTemplates', starterCampaignId],
    queryFn: async () => {
      if (!starterCampaignId) return [];

      const { data, error } = await supabase
        .from('starter_character_templates')
        .select('*')
        .eq('starter_campaign_id', starterCampaignId)
        .order('display_order');

      if (error) {
        console.error('Error fetching templates:', error);
        return [];
      }

      return (data || []) as StarterTemplate[];
    },
    enabled: !!starterCampaignId,
  });

  // Fetch available characters (only when NOT linked to starter campaign)
  const { data: characters, isLoading: charactersLoading } = useQuery({
    queryKey: ['campaign', campaignId, 'characters', 'play', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('characters')
        .select(
          `
          id, name, race, class, level, avatar_url, background_image,
          character_stats (
            strength, dexterity, constitution,
            intelligence, wisdom, charisma,
            armor_class, max_hit_points
          )
        `,
        )
        .eq('user_id', user.id)
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Character[];
    },
    enabled: !!user?.id && !starterCampaignId && !starterLoading,
  });

  const isLoading = starterLoading || (starterCampaignId ? templatesLoading : charactersLoading);
  const isStarterCampaign = !!starterCampaignId;

  /**
   * Create character from starter template and start game
   */
  const handleSelectTemplate = async (template: StarterTemplate): Promise<void> => {
    if (!user || isCreating) return;

    setIsCreating(true);

    try {
      // Create character from template
      const { data: character, error: charError } = await supabase
        .from('characters')
        .insert({
          user_id: user.id,
          name: template.name,
          race: template.race,
          subrace: template.subrace,
          class: template.class,
          level: template.level,
          background: template.background,
          backstory_elements: template.adapted_backstory,
          description: template.tagline,
          campaign_id: campaignId,
          skill_proficiencies: template.skills.join(', '),
          languages: template.languages,
          image_url: template.portrait_url,
        })
        .select('id')
        .single();

      if (charError) {
        console.error('Error creating character:', charError);
        throw charError;
      }

      // Create character stats
      const abilityScores = template.ability_scores || {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      };

      const { error: statsError } = await supabase.from('character_stats').insert({
        character_id: character.id,
        strength: abilityScores.strength,
        dexterity: abilityScores.dexterity,
        constitution: abilityScores.constitution,
        intelligence: abilityScores.intelligence,
        wisdom: abilityScores.wisdom,
        charisma: abilityScores.charisma,
        max_hit_points: 10 + Math.floor((abilityScores.constitution - 10) / 2),
        current_hit_points: 10 + Math.floor((abilityScores.constitution - 10) / 2),
        armor_class: 10 + Math.floor((abilityScores.dexterity - 10) / 2),
      });

      if (statsError) {
        console.error('Error creating character stats:', statsError);
        // Don't throw - character was created, stats are optional
      }

      toast({
        title: 'Starting Adventure!',
        description: `Beginning your journey with ${template.name} in ${campaignName}.`,
      });

      onClose();

      // Navigate to game with starter campaign reference
      setTimeout(() => {
        navigate(
          `/app/game/${campaignId}?character=${character.id}&starterCampaign=${starterCampaignId}&new=true`,
        );
      }, 0);
    } catch (err) {
      console.error('Error starting with character:', err);
      toast({
        title: 'Error',
        description: 'Failed to create character. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  /**
   * Handles starting a game with an existing character
   */
  const startGameWithCharacter = (character: Character): void => {
    onClose();

    setTimeout(() => {
      navigate(`/app/game/${campaignId}?character=${character.id}&new=true`);
      toast({
        title: 'Starting Adventure!',
        description: `Beginning your journey with ${character.name} in ${campaignName}.`,
      });
    }, 0);
  };

  /**
   * Handles creating a new character
   */
  const handleCreateCharacter = (): void => {
    navigate(`/app/characters/create?campaign=${campaignId}`);
    onClose();
  };

  return {
    isLoading,
    isStarterCampaign,
    templates,
    characters,
    isCreating,
    handleSelectTemplate,
    startGameWithCharacter,
    handleCreateCharacter,
  };
}
