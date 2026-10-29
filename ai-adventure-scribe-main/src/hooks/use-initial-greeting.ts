import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

import type { AIResponse } from '@/services/ai-service';
import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';
import type { ChatMessage } from '@/types/game';
import type { Memory } from '@/types/memory';
import type { RollRequest } from '@/types/roll-request';

import { useToast } from '@/hooks/use-toast';
import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { fetchSessionTrackers } from '@/services/session-trackers';
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

/**
 * #865: how long opening-scene generation may run before the wait is
 * declared stalled and the spinner swaps to a retry control. A healthy
 * opening is one LLM call (the generate route's transport ceiling is
 * 90 s in rest-client), but a wedged chain — a promise that never settles
 * anywhere between the request and the state flip — previously spun
 * forever: the overlay is keyed on `isGenerating`, which only clears when
 * generateInitialGreeting's awaited chain settles. The deadline does NOT
 * cancel the attempt; if it lands late, the scene still displays.
 */
export const GREETING_STALL_TIMEOUT_MS = 45_000;

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
  const attemptRef = useRef(0);
  const [timedOut, setTimedOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // #865: stall watchdog. While a generation is in flight, arm the
  // deadline; the attempt settling (or unmounting) disarms it. The
  // attempt counter re-arms the deadline when a retry starts while the
  // stalled attempt never settled (isGenerating never flipped), so a
  // wedged retry surfaces the control again instead of spinning forever.
  useEffect(() => {
    if (!state.isGenerating) {
      setTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setTimedOut(true), GREETING_STALL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.isGenerating, attempt]);

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
    const myAttempt = ++attemptRef.current;
    setAttempt(myAttempt);
    // #865: each run carries an attempt id so a newer run (the player's
    // retry) supersedes this one. A superseded attempt must not deliver
    // messages, roll requests, a fallback greeting or state: the server
    // dedupe (#2379) covers the greeting message row only — not the
    // fallback greeting or the initial memories — so without this guard
    // a late-settling original could post a fallback after the retry's
    // real scene. (One exception, at the save below: the initial
    // memories of a greeting this attempt already saved.)
    const isSuperseded = () => attemptRef.current !== myAttempt;
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
        if (!isSuperseded()) {
          setState((prev) => ({ ...prev, isGenerating: false, hasGenerated: true }));
        }
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
          const res = await fetchWithAuth(
            `/api/trpc/chronicles.getPreviouslyOn?input=${encodeURIComponent(
              JSON.stringify({ newSessionId: sessionId, campaignId }),
            )}`,
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

      // A retry may have superseded this attempt while the model was
      // generating; the superseded scene is discarded.
      if (isSuperseded()) return;

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

      // #1095: the greeting never passes the use-ai-response latch, so
      // the #1062 envelope line cannot reach it — at a session start the
      // clock showed nothing at all. Same rule as the latch: the
      // opening response's story_trackers stay primary, else fall back
      // to GET the session's trackers, so the session's first turn
      // shows the clock too. A failed GET leaves the greeting as today.
      // The GET is capped at 5s: the greeting has no turn signal, so a
      // hung GET must not stall the session's first message — it
      // degrades to no line, like a failed GET.
      let openingTrackers: Array<{ name: string; value: number; limit: number }> = [];
      if (
        typeof openingResponse !== 'string' &&
        Array.isArray(openingResponse.story_trackers) &&
        openingResponse.story_trackers.length > 0
      ) {
        openingTrackers = openingResponse.story_trackers;
      } else if (sessionId) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
          openingTrackers = (await fetchSessionTrackers(sessionId, controller.signal)) ?? [];
        } finally {
          clearTimeout(timeout);
        }
      }

      // Create chat message from AI response (string only; narration is handled elsewhere)
      const greetingMessage: ChatMessage = {
        // Align with ChatMessage shape from '@/types/game'
        id: crypto.randomUUID(),
        sender: 'dm',
        text: displayTextWithOptions,
        timestamp: new Date().toISOString(),
        // The server keeps one of these per session, so a second mount cannot add another (#2379).
        // GP-015 (#219): the greeting is the session's first narration turn. When it
        // carries no action choices, mark it so the UI says why there are none.
        // Roll-request greetings pause on the dice UI, so they are excluded.
        context: {
          initialGreeting: true,
          noActionOptions: openingRollRequests.length === 0 && structuredOptions.length === 0,
          ...(openingTrackers.length > 0 ? { storyTrackers: openingTrackers } : {}),
        },
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

      // A retry may have started while the save was in flight. The dice
      // UI belongs to the newer attempt then — but the initial memories
      // below belong to THIS attempt: the retry sees the greeting saved
      // here and takes the existing-dialogue branch, which creates no
      // memories, so skipping them would leave the session with none.
      const supersededAfterSave = isSuperseded();

      // 3. Trigger dice UI if opening message contains roll requests
      if (!supersededAfterSave && openingRollRequests.length > 0) {
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

      if (!isSuperseded()) {
        setState((prev) => ({
          ...prev,
          isGenerating: false,
          hasGenerated: true,
        }));
      }
    } catch (error) {
      // A superseded attempt delivers nothing — no fallback greeting, no
      // error state; the newer attempt owns the session.
      if (isSuperseded()) return;

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

  const generateRef = useRef(generateInitialGreeting);
  useEffect(() => {
    generateRef.current = generateInitialGreeting;
  });

  // #865: the retry control's handler. Runs the generation again; the new
  // run supersedes any still-in-flight attempt (see the attempt guard in
  // generateInitialGreeting), so the player can retry at the stall
  // deadline without waiting for the original to settle. The one-shot
  // trigger stays armed — retry IS the trigger, and disarming it would
  // let the auto-trigger effect fire an extra unrequested generation if
  // this attempt ends with both state flags false.
  const retry = useCallback(() => {
    hasTriggeredRef.current = true;
    setTimedOut(false);
    void generateRef.current();
  }, []);

  // ⚡ Bolt: Wrap the returned object in useMemo to enforce referential stability
  // and prevent downstream component re-renders when consumed context/initial greeting states are stable.
  return useMemo(
    () => ({
      isGenerating: state.isGenerating,
      hasGenerated: state.hasGenerated,
      error: state.error,
      timedOut,
      retry,
    }),
    [state.isGenerating, state.hasGenerated, state.error, timedOut, retry],
  );
};
