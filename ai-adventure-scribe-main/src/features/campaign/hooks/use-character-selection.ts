import { useQuery } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { seedStarterCharacter } from '@/services/character/starter-character-seeding';
import { userDataApi } from '@/services/user-data-api';

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

export interface UseCharacterSelectionProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName: string;
}

export interface UseCharacterSelectionReturn {
  isCreating: boolean;
  isLoading: boolean;
  isStarterCampaign: boolean;
  templates: StarterTemplate[] | undefined;
  characters: Character[] | undefined;
  starterCampaignId: string | null | undefined;
  handleSelectTemplate: (template: StarterTemplate) => Promise<void>;
  startGameWithCharacter: (character: Character) => void;
  handleCreateCharacter: () => void;
  getModifier: (score?: number) => string;
}

export function useCharacterSelection({
  isOpen,
  onClose,
  campaignId,
  campaignName,
}: UseCharacterSelectionProps): UseCharacterSelectionReturn {
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
        logger.error('Error checking starter campaign link:', error);
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
        logger.error('Error fetching templates:', error);
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

      return userDataApi.listCharacters(campaignId) as Promise<Character[]>;
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
      const character = await seedStarterCharacter(template, campaignId, (payload) =>
        userDataApi.createCharacter(payload),
      );

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
      logger.error('Error starting with character:', err);
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

  /**
   * Helper function to calculate ability modifier.
   * ⚡ Bolt: Wrapped in useCallback with empty dependency array to stabilize identity.
   */
  const getModifier = useCallback((score?: number): string => {
    if (!score) return '+0';
    const mod = Math.floor((score - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  }, []);

  return {
    isCreating,
    isLoading,
    isStarterCampaign,
    templates,
    characters,
    starterCampaignId,
    handleSelectTemplate,
    startGameWithCharacter,
    handleCreateCharacter,
    getModifier,
  };
}
