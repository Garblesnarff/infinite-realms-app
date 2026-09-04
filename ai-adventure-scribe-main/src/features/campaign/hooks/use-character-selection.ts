import { useQuery } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { resolveStarterCampaignIdFromSessionList } from '../../../../shared/session-list-contract';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
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
  card_image_url: string | null;
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
  /**
   * The whole account roster, loaded only when the campaign-bound list came back
   * empty (#2142). Undefined while the bound list has entries.
   */
  accountCharacters: Character[] | undefined;
  loadError: Error | null;
  retryLoad: () => void;
  starterCampaignId: string | null | undefined;
  handleSelectTemplate: (template: StarterTemplate) => Promise<void>;
  startGameWithCharacter: (character: Character) => void;
  handleCreateCharacter: () => void;
  getModifier: (score?: number) => string;
}

interface CampaignStarterLinkResponse {
  starter_campaign_id?: unknown;
}

type StarterLinkApi = Pick<typeof userDataApi, 'getCampaign' | 'listSessions'>;

/**
 * Resolve the starter campaign for a user-owned campaign.
 *
 * Campaigns created through Explore carry the durable link on their own row. Older
 * campaigns may only have the link on a prior session, so retain that lookup as a
 * compatibility fallback while the backfill runs.
 */
export async function resolveStarterCampaignIdForCampaign(
  campaignId: string,
  api: StarterLinkApi = userDataApi,
): Promise<string | null> {
  const campaign = (await api.getCampaign(campaignId)) as CampaignStarterLinkResponse | null;
  const campaignStarterCampaignId = campaign?.starter_campaign_id;
  if (typeof campaignStarterCampaignId === 'string' && campaignStarterCampaignId.trim()) {
    return campaignStarterCampaignId;
  }

  const sessions = await api.listSessions({ campaignId, starterOnly: true, limit: 1 });
  return resolveStarterCampaignIdFromSessionList(sessions);
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
  const {
    data: starterCampaignId,
    isLoading: starterLoading,
    error: starterLinkError,
    refetch: refetchStarterLink,
  } = useQuery({
    queryKey: ['campaign', campaignId, 'starterLink'],
    queryFn: async () => {
      if (!user?.id) return null;

      return resolveStarterCampaignIdForCampaign(campaignId);
    },
    enabled: !!user?.id && isOpen,
  });

  // Fetch starter character templates (only when linked to starter campaign)
  const {
    data: templates,
    isLoading: templatesLoading,
    error: templatesError,
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: ['starterTemplates', starterCampaignId],
    queryFn: async () => {
      if (!starterCampaignId) return [];

      return userDataApi.listStarterCharacterTemplates(starterCampaignId) as Promise<
        StarterTemplate[]
      >;
    },
    enabled: !!starterCampaignId,
  });

  // Fetch available characters (only when NOT linked to starter campaign)
  const {
    data: characters,
    isLoading: charactersLoading,
    error: charactersError,
    refetch: refetchCharacters,
  } = useQuery({
    queryKey: ['campaign', campaignId, 'characters', 'play', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      return userDataApi.listCharacters(campaignId) as Promise<Character[]>;
    },
    enabled: !!user?.id && !starterCampaignId && !starterLoading && !starterLinkError,
  });

  const boundLoading = starterLoading || (starterCampaignId ? templatesLoading : charactersLoading);
  const isStarterCampaign = !!starterCampaignId;
  const boundError = (starterLinkError ||
    (starterCampaignId ? templatesError : charactersError)) as Error | null;
  const boundList = starterCampaignId ? templates : characters;
  // #2142: a campaign with nothing bound to it (an old or brand-new custom campaign)
  // must not hide the account's characters behind "no characters yet".
  const boundListEmpty = !boundLoading && !boundError && boundList?.length === 0;

  const {
    data: accountCharacters,
    isLoading: accountLoading,
    error: accountError,
    refetch: refetchAccountCharacters,
  } = useQuery({
    queryKey: ['characters', 'account', user?.id],
    queryFn: async () => userDataApi.listCharacters() as Promise<Character[]>,
    enabled: !!user?.id && isOpen && boundListEmpty,
  });

  const isLoading = boundLoading || (boundListEmpty && accountLoading);
  const loadError = boundError || (boundListEmpty ? (accountError as Error | null) : null);
  const retryLoad = (): void => {
    if (starterLinkError) {
      void refetchStarterLink();
    } else if (boundError) {
      void (starterCampaignId ? refetchTemplates() : refetchCharacters());
    } else {
      void refetchAccountCharacters();
    }
  };

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
   * Handles creating a new character.
   *
   * Deliberately synchronous, unlike the setTimeout(0) in handleSelectTemplate and
   * startGameWithCharacter. The onClose()-first ordering inside a single task is the
   * #2142 fix itself: CampaignHub's onClose navigates with { replace: true } to drop
   * ?startSession, and the old navigate-then-onClose order let that replace cancel
   * this navigation. Keeping both calls in one synchronous sequence makes the ordering
   * explicit instead of hiding it behind a timer. (The existing "handles
   * handleCreateCharacter" test also asserts the navigate happens in the same task.)
   */
  const handleCreateCharacter = (): void => {
    // Close first: CampaignHub's onClose navigates (replace) to drop ?startSession,
    // and running it after this navigation cancelled it, so Create only closed
    // the modal (#2142).
    onClose();
    navigate(`/app/characters/create?campaign=${encodeURIComponent(campaignId)}`);
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
    accountCharacters: boundListEmpty ? accountCharacters : undefined,
    loadError,
    retryLoad,
    starterCampaignId,
    handleSelectTemplate,
    startGameWithCharacter,
    handleCreateCharacter,
    getModifier,
  };
}
