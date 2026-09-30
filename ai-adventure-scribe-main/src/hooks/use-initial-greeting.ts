import { useState, useEffect, useRef, useMemo } from 'react';

import type { AIResponse } from '@/services/ai-service';
import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';
import type { ChatMessage } from '@/types/game';
import type { Memory } from '@/types/memory';
import type { RollRequest } from '@/types/roll-request';

import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { getAccessToken } from '@/services/auth/TokenService';
import { userDataApi } from '@/services/user-data-api';
import { ensureActionOptions } from '@/utils/ensure-action-options';
import { createInitialMemories } from '@/utils/game-session/initial-greeting-memories';
import { truncateAtRollRequest } from '@/utils/roll-request/validate';
import { parseRollRequests } from '@/utils/rollRequestParser';

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
  onRollRequestsDetected?: (requests: RollRequest[]) => void;
  onMemoryCreated?: (memory: Omit<Memory, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
}

interface InitialGreetingState {
  isGenerating: boolean;
  hasGenerated: boolean;
  error: string | null;
}

const GREETING_MIN_LENGTH = 50;

const storedMessageText = (message: Record<string, unknown> | undefined): string => {
  const text = message?.text ?? message?.message;
  return typeof text === 'string' ? text.trim() : '';
};

const isShortStoredGreeting = (message: Record<string, unknown> | undefined): boolean =>
  storedMessageText(message).length > 0 && storedMessageText(message).length < GREETING_MIN_LENGTH;

const replaceOpeningSceneMemory = async (
  sessionId: string,
  greetingText: string,
): Promise<boolean> => {
  try {
    const memories = await userDataApi.listMemories(sessionId, { limit: 200 });
    const openingScene = memories.find(
      (memory) =>
        typeof memory?.id === 'string' &&
        typeof memory?.content === 'string' &&
        memory.content.startsWith('Opening Scene:'),
    );
    if (openingScene) {
      await userDataApi.updateMemoryContent(openingScene.id, `Opening Scene: ${greetingText}`);
      logger.info('[Initial Greeting] Repaired existing Opening Scene memory', openingScene.id);
      return true;
    }
  } catch (error) {
    logger.warn('[Initial Greeting] Could not replace existing Opening Scene memory:', error);
  }
  return false;
};

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
  onRollRequestsDetected,
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
    const onlyFallbackMessage =
      messages.length === 1 &&
      messages[0].sender === 'dm' &&
      (messages[0].context?.isFallback === true ||
        isShortStoredGreeting(messages[0] as unknown as Record<string, unknown>));
    const shouldGenerateGreeting =
      sessionId &&
      sessionData &&
      sessionData.turn_count === 0 &&
      (messages.length === 0 || onlyFallbackMessage) &&
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
      const { total: existingMessageCount, messages: existingMessages } =
        await userDataApi.listSessionMessages(sessionId!, 0, 10);

      const isOnlyFallbackMessage =
        existingMessageCount === 1 &&
        existingMessages?.length === 1 &&
        existingMessages[0]?.speaker_type === 'dm' &&
        (existingMessages[0]?.context?.isFallback === true ||
          isShortStoredGreeting(existingMessages[0] as Record<string, unknown>));

      if ((existingMessageCount ?? 0) > 0 && !isOnlyFallbackMessage) {
        logger.info(
          '[Initial Greeting] Detected existing dialogue entries; skipping automated greeting.',
        );
        setState((prev) => ({ ...prev, isGenerating: false, hasGenerated: true }));
        return;
      }

      // ⚡ Bolt: Parallelize character and campaign data fetching to reduce total latency.
      // Also used explicit column selection instead of select('*') to minimize data transfer.
      const [characterResult, campaignResult] = await Promise.all([
        userDataApi.getCharacter(characterId as string).then((data) => ({ data, error: null })),
        userDataApi.getCampaign(campaignId as string).then((data) => ({ data, error: null })),
      ]);

      const { data: characterData } = characterResult;
      const { data: campaignData } = campaignResult;

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
          const token = getAccessToken();
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
      const openingResponse = (await AIService.generateOpeningMessage({
        context: {
          campaignId: campaignId as string,
          characterId: characterId as string,
          sessionId: sessionId!,
          starterCampaignId: sessionData?.starter_campaign_id ?? undefined,
          // These are stored as loose records in AIService, so cast to Record<string, unknown>
          campaignDetails: campaignData as unknown as Record<string, unknown>,
          characterDetails: characterData as unknown as Record<string, unknown>,
          // Thread the recap into the opening-generation prompt so the DM opens with
          // continuity instead of only seeing it as a display message afterward.
          previousSessionRecap: previouslyOnText ?? undefined,
        },
      })) as AIResponse | string;
      const openingText =
        typeof openingResponse === 'string' ? openingResponse : openingResponse.text;
      if (typeof openingText !== 'string' || openingText.trim().length < GREETING_MIN_LENGTH) {
        throw new Error('Opening message was too short to be a valid scene');
      }

      // Only parse structured ROLL_REQUESTS_V1 blocks from the opening message.
      // Regex-based prose detection is intentionally skipped here: option descriptions
      // often contain informational roll hints like "(Roll for Persuasion if you choose B)"
      // which are not actual roll requests and would trigger false dice popups.
      const hasStructuredRollBlock = /```ROLL_REQUESTS_V1[\s\S]*?```/.test(openingText);
      const openingRollRequests = hasStructuredRollBlock ? parseRollRequests(openingText) : [];
      const displayText =
        openingRollRequests.length > 0 ? truncateAtRollRequest(openingText) : openingText;

      // The greeting uses the same schema-constrained response as ordinary turns. Preserve
      // those contextual options in the text path used by the existing message renderer.
      const structuredOptions =
        typeof openingResponse === 'string' || !Array.isArray(openingResponse.options)
          ? []
          : openingResponse.options.filter(
              (option): option is string => typeof option === 'string' && option.trim().length > 0,
            );
      const displayTextWithOptions =
        openingRollRequests.length > 0
          ? displayText
          : structuredOptions.length > 0
            ? `${displayText.trim()}\n\n${structuredOptions.join('\n')}`
            : await ensureActionOptions(displayText);

      // Create chat message from AI response (string only; narration is handled elsewhere)
      const greetingMessage: ChatMessage = {
        // Align with ChatMessage shape from '@/types/game'
        id: crypto.randomUUID(),
        sender: 'dm',
        text: displayTextWithOptions,
        timestamp: new Date().toISOString(),
        // The server keeps one of these per session, so a second mount cannot add another (#2379).
        context: { initialGreeting: true },
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

      // 3. Trigger dice UI if opening message contains roll requests
      if (openingRollRequests.length > 0) {
        logger.info(
          `[Initial Greeting] Detected ${openingRollRequests.length} roll request(s) in opening message`,
        );
        onRollRequestsDetected?.(openingRollRequests);
      }

      // Create initial memories if callback is provided (use displayText to avoid raw ROLL_REQUESTS blocks)
      if (onMemoryCreated && sessionId) {
        const openingSceneReplaced = isOnlyFallbackMessage
          ? await replaceOpeningSceneMemory(sessionId, displayText)
          : false;
        await createInitialMemories(
          sessionId,
          characterData as unknown as Character,
          campaignData as unknown as Campaign,
          displayText,
          onMemoryCreated,
          { skipOpeningScene: openingSceneReplaced },
        );
      }

      setState((prev) => ({
        ...prev,
        isGenerating: false,
        hasGenerated: true,
      }));
    } catch (error) {
      logger.error('[Initial Greeting] Error generating greeting:', {
        error,
        sessionId,
        characterId,
        campaignId,
        starterCampaignId: sessionData?.starter_campaign_id,
        turnCount: sessionData?.turn_count,
        loadedMessageCount: messages.length,
      });

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
          context: { isFallback: true },
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

  // ⚡ Bolt: Wrap the returned object in useMemo to enforce referential stability
  // and prevent downstream component re-renders when consumed context/initial greeting states are stable.
  return useMemo(
    () => ({
      isGenerating: state.isGenerating,
      hasGenerated: state.hasGenerated,
      error: state.error,
    }),
    [state.isGenerating, state.hasGenerated, state.error],
  );
};
