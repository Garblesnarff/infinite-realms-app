import { useState, useEffect, useRef } from 'react';

import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';
import type { ChatMessage } from '@/types/game';
import type { Memory, MemoryType } from '@/types/memory';

import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';

interface InitialGreetingProps {
  sessionId: string | null;
  sessionData: {
    turn_count?: number;
    starter_campaign_id?: string | null;
    session_number?: number | null;
  } | null;
  characterId: string | null;
  campaignId: string | null;
  messages: ChatMessage[];
  messagesLoading?: boolean;
  onGreetingGenerated: (message: ChatMessage) => Promise<void>;
  onMemoryCreated?: (memory: Omit<Memory, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
}

interface InitialGreetingState {
  isGenerating: boolean;
  hasGenerated: boolean;
  error: string | null;
}

/**
 * useInitialGreeting Hook
 *
 * Automatically generates an initial DM greeting for new game sessions.
 * Triggers when:
 * - Session exists and is active
 * - Turn count is 0 (new session)
 * - No messages exist yet
 * - Character and campaign data are loaded
 */
export const useInitialGreeting = ({
  sessionId,
  sessionData,
  characterId,
  campaignId,
  messages,
  messagesLoading = false,
  onGreetingGenerated,
  onMemoryCreated,
}: InitialGreetingProps) => {
  const [state, setState] = useState<InitialGreetingState>({
    isGenerating: false,
    hasGenerated: false,
    error: null,
  });

  const { toast } = useToast();
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    const shouldGenerateGreeting =
      sessionId &&
      sessionData &&
      sessionData.turn_count === 0 &&
      messages.length === 0 &&
      characterId &&
      campaignId &&
      !state.hasGenerated &&
      !state.isGenerating &&
      !hasTriggeredRef.current &&
      messagesLoading === false;

    if (shouldGenerateGreeting) {
      hasTriggeredRef.current = true;
      generateInitialGreeting();
    }
  }, [
    sessionId,
    sessionData,
    characterId,
    campaignId,
    messages.length,
    state.hasGenerated,
    state.isGenerating,
    messagesLoading,
  ]);

  const generateInitialGreeting = async () => {
    setState((prev) => ({ ...prev, isGenerating: true, error: null }));

    try {
      logger.info('[Initial Greeting] Starting generation for session:', sessionId);

      // Ensure we are not resuming an existing conversation
      const { count: existingMessageCount, error: countError } = await supabase
        .from('dialogue_history')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', sessionId!);

      if (countError) {
        logger.warn(
          '[Initial Greeting] Failed to check existing messages, continuing with caution',
          countError,
        );
      }

      if ((existingMessageCount ?? 0) > 0) {
        logger.info(
          '[Initial Greeting] Detected existing dialogue entries; skipping automated greeting.',
        );
        setState((prev) => ({ ...prev, isGenerating: false, hasGenerated: true }));
        return;
      }

      // ⚡ Bolt: Parallelize character and campaign data fetching to reduce total latency.
      // Also used explicit column selection instead of select('*') to minimize data transfer.
      const [characterResult, campaignResult] = await Promise.all([
        supabase
          .from('characters')
          .select(
            `
            id, name, level, race, class, background,
            character_stats(strength, dexterity, constitution, intelligence, wisdom, charisma)
          `,
          )
          .eq('id', characterId as string)
          .single(),
        supabase
          .from('campaigns')
          .select('id, name, description')
          .eq('id', campaignId as string)
          .single(),
      ]);

      const { data: characterData, error: characterError } = characterResult;
      const { data: campaignData, error: campaignError } = campaignResult;

      if (characterError) {
        throw new Error(`Failed to load character: ${characterError.message}`);
      }

      if (campaignError) {
        throw new Error(`Failed to load campaign: ${campaignError.message}`);
      }

      logger.info('[Initial Greeting] Generated prompt for AI service');

      // Fetch "Previously On" recap for continuation sessions (session_number > 1)
      let previouslyOnText: string | null = null;
      if (
        sessionData?.session_number &&
        sessionData.session_number > 1 &&
        campaignId &&
        sessionId
      ) {
        try {
          const token = localStorage.getItem('workos_access_token');
          const res = await fetch(
            `/api/trpc/chronicles.getPreviouslyOn?input=${encodeURIComponent(
              JSON.stringify({ newSessionId: sessionId, campaignId }),
            )}`,
            token ? { headers: { Authorization: `Bearer ${token}` } } : {},
          );
          if (res.ok) {
            const json = await res.json();
            previouslyOnText = json?.result?.data?.previouslyOn ?? null;
          }
        } catch {
          // Non-blocking — failure just means no recap shown
        }
      }

      // Generate AI response using AIService
      const openingText = await AIService.generateOpeningMessage({
        context: {
          campaignId: campaignId as string,
          characterId: characterId as string,
          sessionId: sessionId!,
          starterCampaignId: sessionData?.starter_campaign_id ?? undefined,
          // These are stored as loose records in AIService, so cast to Record<string, unknown>
          campaignDetails: campaignData as unknown as Record<string, unknown>,
          characterDetails: characterData as unknown as Record<string, unknown>,
        },
      });

      // Create chat message from AI response (string only; narration is handled elsewhere)
      const greetingMessage: ChatMessage = {
        // Align with ChatMessage shape from '@/types/game'
        id: crypto.randomUUID(),
        sender: 'dm',
        text: openingText,
        timestamp: new Date().toISOString(),
      };

      logger.info(
        '[Initial Greeting] Generated initial greeting:',
        greetingMessage.text.substring(0, 100) + '...',
      );

      // 1. Inject "Previously On" recap if this is a continuation session
      if (previouslyOnText) {
        const previouslyOnMessage: ChatMessage = {
          id: crypto.randomUUID(),
          sender: 'dm',
          text: previouslyOnText,
          timestamp: new Date().toISOString(),
          context: { previouslyOn: true },
        };
        await onGreetingGenerated(previouslyOnMessage);
      }

      // 2. Normal DM opening message
      await onGreetingGenerated(greetingMessage);

      // Create initial memories if callback is provided
      if (onMemoryCreated) {
        await createInitialMemories(
          characterData as unknown as Character,
          campaignData as unknown as Campaign,
          openingText,
          onMemoryCreated,
        );
      }

      setState((prev) => ({
        ...prev,
        isGenerating: false,
        hasGenerated: true,
      }));
    } catch (error) {
      logger.error('[Initial Greeting] Error generating greeting:', error);

      setState((prev) => ({
        ...prev,
        isGenerating: false,
        error: error instanceof Error ? error.message : 'Failed to generate initial greeting',
      }));

      // Provide a fallback greeting to prevent empty state
      try {
        logger.info('[Initial Greeting] Providing fallback greeting');
        const fallbackMessage: ChatMessage = {
          id: crypto.randomUUID(),
          sender: 'dm',
          text: 'You find yourself standing at the threshold of adventure. The world stretches before you, full of mysteries waiting to be uncovered. What do you do?',
          timestamp: new Date().toISOString(),
        };
        await onGreetingGenerated(fallbackMessage);

        setState((prev) => ({
          ...prev,
          hasGenerated: true,
        }));
      } catch (fallbackError) {
        logger.error('[Initial Greeting] Fallback greeting also failed:', fallbackError);

        toast({
          title: 'Adventure Setup',
          description:
            'Had trouble setting up your adventure. You can still start by describing what your character does!',
          variant: 'default',
        });
      }
    }
  };

  const createInitialMemories = async (
    character: Character,
    campaign: Campaign,
    greetingText: string,
    onMemoryCreated: (memory: Omit<Memory, 'id' | 'created_at' | 'updated_at'>) => Promise<void>,
  ) => {
    try {
      logger.info('[Initial Greeting] Creating foundational memories');

      // Create character introduction memory
      await onMemoryCreated({
        session_id: sessionId!,
        type: 'character_moment' as MemoryType,
        subcategory: 'player',
        content: `${character.name}, a ${character.race?.name || character.race} ${character.class?.name || character.class} of level ${character.level || 1}, begins their adventure. Background: ${character.background?.name || character.background || 'Unknown'}.`,
        importance: 5,
        metadata: {
          character_id: character.id,
          character_name: character.name,
          is_player_character: true,
          is_initial_memory: true,
        },
      });

      // Create campaign world memory
      await onMemoryCreated({
        session_id: sessionId!,
        type: 'world_detail' as MemoryType,
        subcategory: 'general',
        content: `Campaign: ${campaign.name || 'Untitled Adventure'}. ${campaign.description || 'A world of adventure awaits.'}`,
        importance: 4,
        metadata: {
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          is_initial_memory: true,
        },
      });

      // Create opening scene memory from the DM's greeting
      await onMemoryCreated({
        session_id: sessionId!,
        type: 'location' as MemoryType,
        subcategory: 'current_location',
        content: `Opening Scene: ${greetingText}`,
        importance: 4,
        metadata: {
          scene_type: 'opening',
          is_initial_memory: true,
          turn_count: 0,
        },
      });

      // Create atmosphere memory
      const atmosphereContent = extractAtmosphereFromGreeting(greetingText);
      if (atmosphereContent) {
        await onMemoryCreated({
          session_id: sessionId!,
          type: 'atmosphere' as MemoryType,
          subcategory: 'environment',
          content: atmosphereContent,
          importance: 3,
          metadata: {
            scene_type: 'opening',
            is_initial_memory: true,
          },
        });
      }

      logger.info('[Initial Greeting] Successfully created all foundational memories');
    } catch (error) {
      logger.error('[Initial Greeting] Error creating initial memories:', error);
      // Don't throw here - memory creation failure shouldn't break the greeting flow
    }
  };

  const extractAtmosphereFromGreeting = (greetingText: string): string | null => {
    // Simple extraction of atmospheric details from the greeting
    // This could be enhanced with more sophisticated parsing
    const sentences = greetingText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const atmosphericWords = [
      'weather',
      'sun',
      'moon',
      'wind',
      'air',
      'smell',
      'sound',
      'feeling',
      'atmosphere',
      'mood',
      'ambiance',
    ];

    const atmosphericSentences = sentences.filter((sentence) =>
      atmosphericWords.some((word) => sentence.toLowerCase().includes(word)),
    );

    return atmosphericSentences.length > 0
      ? `Initial atmosphere: ${atmosphericSentences.join('. ').trim()}.`
      : null;
  };

  return {
    isGenerating: state.isGenerating,
    hasGenerated: state.hasGenerated,
    error: state.error,
  };
};
