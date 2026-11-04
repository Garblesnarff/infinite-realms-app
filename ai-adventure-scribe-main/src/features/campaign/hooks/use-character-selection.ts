import { useQuery } from '@tanstack/react-query';
import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { abilityModifier } from '../../../../shared/ability-modifier';
import { resolveStarterCampaignIdFromSessionList } from '../../../../shared/session-list-contract';

import { useAuth } from '@/contexts/AuthContext';
import {
  loadPairSessionStart,
  sessionStartGameTarget,
} from '@/features/session-start/session-start-decision';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import {
  buildSavedPlaythroughs,
  loadPlaythroughCharacters,
  type SavedPlaythrough,
} from '@/pages/saved-playthroughs';
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
   * The whole account roster: loaded when the campaign-bound list came back
   * empty (#2142), and additionally for starter campaigns alongside their
   * templates (#321). Undefined otherwise.
   */
  accountCharacters: Character[] | undefined;
  /**
   * #321: the account-roster fetch error, surfaced only on starter campaigns
   * where the roster is a peer section (elsewhere it folds into loadError).
   * The modal renders an inline retry for it; the full-modal loadError must
   * not hide the templates.
   */
  rosterError: Error | null;
  loadError: Error | null;
  retryLoad: () => void;
  starterCampaignId: string | null | undefined;
  handleSelectTemplate: (template: StarterTemplate) => Promise<void>;
  startGameWithCharacter: (character: Character) => Promise<void>;
  handleCreateCharacter: () => void;
  getModifier: (score?: number) => string;
  /**
   * #1380: set when a template pick finds more than one saved playthrough
   * for that hero name. The modal renders the "Choose a saved playthrough"
   * picker for these rows; choosing one continues that character, closing
   * the picker without choosing seeds nothing.
   */
  playthroughChoices: SavedPlaythrough[] | null;
  choosePlaythrough: (choice: SavedPlaythrough) => void;
  clearPlaythroughChoices: () => void;
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
  // #209: synchronous in-flight guard. setIsCreating is async, so two fast
  // clicks (double-click / double-tap) both read isCreating=false and create
  // twice — the duplicate-premade root cause. The ref flips synchronously.
  const creatingRef = useRef(false);
  const [playthroughChoices, setPlaythroughChoices] = useState<SavedPlaythrough[] | null>(null);

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

      const sessions = await userDataApi.listSessions({ campaignId, starterOnly: true, limit: 1 });
      return resolveStarterCampaignIdFromSessionList(sessions);
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

  // #321: starter campaigns also load the account roster, so a saved custom
  // character can start a session there. The roster is an addition to the
  // templates, never a fallback for a failed template load — the modal only
  // renders this section when templates loaded, keeping the #2193
  // load-failure state roster-free.
  const {
    data: accountCharacters,
    isLoading: accountLoading,
    error: accountError,
    refetch: refetchAccountCharacters,
  } = useQuery({
    queryKey: ['characters', 'account', user?.id],
    queryFn: async () => userDataApi.listCharacters() as Promise<Character[]>,
    enabled: !!user?.id && isOpen && (boundListEmpty || isStarterCampaign),
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
    if (!user || creatingRef.current) return;

    creatingRef.current = true;
    setIsCreating(true);

    try {
      // #1380: a template pick must not blind-seed over a saved playthrough
      // of the same hero name. List the campaign's sessions and build the
      // saved rows for this template's name — the same builder the explore
      // page's picker uses. A list failure fails closed (no seed): seeding
      // blind would strand the unread playthrough behind a fresh hero.
      let saved: SavedPlaythrough[];
      try {
        const campaignSessions: unknown[] = [];
        const pageSize = 100;
        for (let offset = 0; ; offset += pageSize) {
          const page = await userDataApi.listSessions({
            campaignId,
            limit: pageSize,
            offset,
          });
          campaignSessions.push(...page);
          if (page.length < pageSize) break;
        }
        const base = {
          sessions: campaignSessions,
          starterCampaignId: starterCampaignId ?? '',
          heroName: template.name,
          campaignId,
        };
        saved = buildSavedPlaythroughs({ ...base, characters: [] });
        if (saved.length > 1) {
          // Second pass with vitals, exactly like the explore page: the
          // picker rows show HP, and a missing roster leaves HP unknown.
          saved = buildSavedPlaythroughs({
            ...base,
            characters: await loadPlaythroughCharacters(campaignId),
          });
        }
      } catch (err) {
        logger.error('Error finding saved playthroughs:', err);
        toast({
          title: 'Error',
          description: 'Could not find your saved playthrough. Try again.',
          variant: 'destructive',
        });
        return;
      }

      if (saved.length > 1) {
        setPlaythroughChoices(saved);
        return;
      }
      if (saved.length === 1) {
        // One saved playthrough: continue that character, no seed, no fresh
        // session. The game route resumes its active session or creates the
        // N+1 continuation itself.
        onClose();
        const starterParam = starterCampaignId ? `&starterCampaign=${starterCampaignId}` : '';
        navigate(`/app/game/${campaignId}?character=${saved[0].characterId}${starterParam}`);
        return;
      }

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
      }
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  /**
   * Handles starting a game with an existing character.
   * #1380: the pair goes through the shared session-start decision first —
   * an active session resumes, a completed one continues through the game
   * route, and only no sessions at all takes the old force-new path. On a
   * starter-linked campaign the starter id rides along (#321), exactly
   * like handleSelectTemplate: the session needs starter_campaign_id for
   * the DM's starter lore, combat difficulty, and the choose-hero flow.
   * A list failure fails closed (toast, no navigate, no create).
   */
  const startGameWithCharacter = async (character: Character): Promise<void> => {
    onClose();

    let decision;
    try {
      decision = await loadPairSessionStart({
        campaignId,
        characterId: character.id,
        fallbackStarterCampaignId: starterCampaignId ?? null,
      });
    } catch (err) {
      logger.error('Error finding existing sessions:', err);
      toast({
        title: 'Error',
        description: 'Could not find your saved playthrough. Try again.',
        variant: 'destructive',
      });
      return;
    }
    const target = sessionStartGameTarget({ campaignId, characterId: character.id, decision });
    if (target) {
      navigate(target);
      return;
    }

    const starterParam = starterCampaignId ? `&starterCampaign=${starterCampaignId}` : '';
    navigate(`/app/game/${campaignId}?character=${character.id}${starterParam}&new=true`);
    toast({
      title: 'Starting Adventure!',
      description: `Beginning your journey with ${character.name} in ${campaignName}.`,
    });
  };

  /**
   * #1380: continue the playthrough the picker chose. The game route
   * resumes the row's active session or creates its N+1 continuation, so
   * no session id and no ?new=true ride along.
   */
  const choosePlaythrough = (choice: SavedPlaythrough): void => {
    setPlaythroughChoices(null);
    onClose();
    const starterParam = starterCampaignId ? `&starterCampaign=${starterCampaignId}` : '';
    navigate(`/app/game/${campaignId}?character=${choice.characterId}${starterParam}`);
  };

  const clearPlaythroughChoices = (): void => {
    setPlaythroughChoices(null);
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
    const mod = abilityModifier(score);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  }, []);

  return {
    isCreating,
    isLoading,
    isStarterCampaign,
    templates,
    characters,
    accountCharacters: boundListEmpty || isStarterCampaign ? accountCharacters : undefined,
    rosterError: isStarterCampaign ? (accountError as Error | null) : null,
    loadError,
    retryLoad,
    starterCampaignId,
    handleSelectTemplate,
    startGameWithCharacter,
    handleCreateCharacter,
    getModifier,
    playthroughChoices,
    choosePlaythrough,
    clearPlaythroughChoices,
  };
}
