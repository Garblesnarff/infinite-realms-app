// External/SDK Imports
import { useRef, useCallback, useState } from 'react';

import type { SceneSpec } from '../../../server-bun/src/tactical/types';
import type { ImageRequest, LocalNotice } from '@/hooks/ai/types';
import type { TurnPhaseReporter } from '@/infrastructure/api/rest-client';
import type { AIResponse } from '@/services/ai-service';
import type { AdvanceNpcTurnsResponse } from '@/services/user-data-api';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { CombatEngineBlock } from '@/utils/combat-engine-blocks';
import type { DetectedEnemy, DetectedCombatAction } from '@/utils/combatDetection';

import { useAuth } from '@/contexts/AuthContext';
import { useCombat } from '@/contexts/CombatContext';
import { useGame } from '@/contexts/GameContext';
import { fetchGameContext, buildAIContext } from '@/hooks/ai/ai-utils';
import {
  heldEntryResult,
  holdCombatEntryBeforeDm,
  recentNarrationFrom,
} from '@/hooks/ai/combat-entry-hold';
import {
  COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED,
  NPC_FIRST_ADVANCE_FAILED_NOTICE,
  combatTurnErrorMessage,
  combatTurnUiStateForEncounter,
  INITIAL_COMBAT_TURN_UI_STATE,
  preflightErrorStatus,
  preflightNpcTurnsBeforePlayerDeclaration,
  reconcileCombatTurnAfterAction,
  type CombatTurnUiState,
} from '@/hooks/ai/combat-turn-preflight';
import { conversationHistoryFrom } from '@/hooks/ai/conversation-history';
import { handleDmActionsAndTransitions, showNpcTurnLines } from '@/hooks/ai/dm-actions-handler';
import { updateGamePhase, clampCombatIntentFlags } from '@/hooks/ai/game-phase-updater';
import {
  enforceNarrationGate,
  narrativeTurnHasNoEngineEvent,
  releaseHeldSideEffects,
  type NarrativeTurn,
} from '@/hooks/ai/narration-gate';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { logIncomingRolls, logRollRequests } from '@/hooks/ai/session-logger';
import { suspectsFabricatedOutcome } from '@/hooks/ai/silent-player-turn';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { playerInputOriginOf } from '@/services/combat/combat-action-origin';
import {
  hasPendingPlayerRoll,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';
import { holdSaveCardBeforeDm } from '@/services/combat/sheet-cast-save-hold';
import { MemoryManager } from '@/services/memory-manager';
import { userDataApi } from '@/services/user-data-api';
import { voiceConsistencyService } from '@/services/voice-consistency-service';
import { stripEngineGeneratedLinesFromSegments } from '@/utils/engine-lines';
import { ensureActionOptions } from '@/utils/ensure-action-options';
import { isNarrativeRollRequest } from '@/utils/roll-request/engine-channel';

// Voice narration types
export interface NarrationSegment {
  type: 'narration' | 'dialogue' | 'action' | 'thought' | 'dm' | 'character' | 'transition';
  text: string;
  character?: string;
  voice_category?: string;
}

export interface DiceRoll {
  type: 'attack' | 'damage' | 'saving_throw' | 'ability_check' | 'initiative' | 'skill_check';
  dice_notation: string; // e.g., "1d20+4", "2d6+3"
  result: number;
  modifier: number;
  target?: number; // DC or AC
  success?: boolean;
  critical?: boolean;
  actor: string;
  context: string; // Description of what the roll is for
}

export interface StructuredAIResponse {
  response: string;
  narration_segments?: NarrationSegment[];
  dice_rolls?: DiceRoll[];
  roll_requests?: RollRequest[];
}

/**
 * Render guidance handed to the early-text callback.
 *
 * `suppressRender` is set for any turn the engine may still resolve after the text has been
 * parsed but before the final narration exists (roll requests, combat entry, or an in-combat
 * turn). Rendering the declaration prose on those turns shows a hit or miss the dice have not
 * decided yet — see #2139.
 */
export interface TextReadyOptions {
  suppressRender: boolean;
  /**
   * Whether this turn's `roll_requests` may be put in front of the player from the early
   * callback.
   *
   * On a combat-start or in-combat turn the DM's `roll_requests` are an engine declaration
   * channel, not player dice prompts: `rules-prompts.ts` asks for `initiative` and `attack`
   * entries so the combat pipeline can read the declared action, and
   * `dm-actions-handler.ts` strips both types once the encounter is seated. Prompting with the
   * raw list takes the single visible dice slot away from the engine's own initiative prompt and
   * throws the player's die away — see #2190. So only a non-combat narrative roll turn may
   * prompt early; every other turn waits for the filtered final list.
   */
  earlyRollPromptAllowed: boolean;
}

export interface EnhancedChatMessage extends ChatMessage {
  narrationSegments?: NarrationSegment[];
  diceRolls?: DiceRoll[];
  rollRequests?: RollRequest[];
  imageRequests?: ImageRequest[];
  /** Backwards-compatible newline-delimited engine notice text. */
  localNotice?: string;
  /** Engine-authored notices with per-message persistence ownership. */
  localNotices?: LocalNotice[];
  sceneSpec?: SceneSpec | null;
  combatDetection?: {
    isCombat: boolean;
    confidence: number;
    combatType?: string;
    shouldStartCombat: boolean;
    shouldEndCombat: boolean;
    enemies: DetectedEnemy[];
    combatActions: DetectedCombatAction[];
  };
}

const DEFERRED_TASK_TIMEOUT_MS = 20_000;

function runDeferredTask(label: string, task: () => Promise<unknown>): void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${DEFERRED_TASK_TIMEOUT_MS}ms`)),
      DEFERRED_TASK_TIMEOUT_MS,
    );
  });

  void Promise.race([Promise.resolve().then(task), timeout])
    .catch((error) => logger.error(`[useAIResponse] Deferred ${label} failed:`, error))
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
}

// Re-export RollRequest for backward compatibility
export type { RollRequest } from '@/types/roll-request';

/**
 * useAIResponse Hook
 *
 * Handles AI response generation with memory context window.
 * Formats tasks, fetches game context, and calls the DM Agent.
 *
 * Roll processing, session logging, and phase updates are delegated
 * to extracted modules in src/hooks/ai/.
 *
 * @author AI Dungeon Master Team
 */
export const useAIResponse = (): {
  getAIResponse: (
    messages: ChatMessage[],
    sessionId: string,
    turnCount?: number,
    onTurnPhase?: TurnPhaseReporter,
    onTextReady?: (message: EnhancedChatMessage, options: TextReadyOptions) => Promise<void> | void,
    dmMessageId?: string,
    onEngineNotice?: (notice: LocalNotice) => void,
  ) => Promise<EnhancedChatMessage>;
  combatTurnUiState: CombatTurnUiState;
  resumeCombatTurn: () => Promise<void>;
} => {
  const { setGamePhase, state: gameState } = useGame();
  const { refreshCombatState } = useCombat();
  const { user, userPlan } = useAuth();
  const [combatTurnUiState, setCombatTurnUiState] = useState<CombatTurnUiState>(
    INITIAL_COMBAT_TURN_UI_STATE,
  );
  const lastSigRef = useRef<string>('');
  const lastCombatSessionIdRef = useRef<string>('');
  const lastCombatCharacterIdRef = useRef<string>('');
  const lastCombatEncounterRef = useRef<Awaited<ReturnType<typeof refreshCombatState>>>();
  // Track processed roll request signatures to prevent infinite re-parsing loops
  const processedRollRequestsRef = useRef<Set<string>>(new Set());

  const resumeCombatTurn = useCallback(async (): Promise<void> => {
    const sessionId = lastCombatSessionIdRef.current;
    if (!sessionId) return;

    setCombatTurnUiState((previous) => ({ ...previous, preflight: 'running', error: undefined }));
    try {
      const reconciliation = await reconcileCombatTurnAfterAction({
        sessionId,
        activeEncounter: lastCombatEncounterRef.current,
        characterId: lastCombatCharacterIdRef.current,
        refreshCombatState,
      });
      lastCombatEncounterRef.current = reconciliation.activeEncounter;
      setCombatTurnUiState(reconciliation.uiState);
    } catch (error) {
      logger.warn('COMBAT_TURN_RESUME_FAILED', {
        sessionId,
        encounterId: lastCombatEncounterRef.current?.id ?? null,
        status: preflightErrorStatus(error),
      });
      setCombatTurnUiState((previous) => ({
        ...previous,
        preflight: 'failed',
        error: combatTurnErrorMessage(error),
      }));
    }
  }, [refreshCombatState]);

  /**
   * Calls the DM Agent to generate a response based on chat history and game context.
   * Handles structured responses with narration segments for voice synthesis.
   *
   * ⚡ Bolt: Memoized response generation to prevent downstream re-renders of
   * components consuming this hook when the parent component re-renders.
   */
  const getAIResponse = useCallback(
    async (
      messages: ChatMessage[],
      sessionId: string,
      turnCount?: number,
      onTurnPhase?: TurnPhaseReporter,
      onTextReady?: (
        message: EnhancedChatMessage,
        options: TextReadyOptions,
      ) => Promise<void> | void,
      dmMessageId?: string,
      onEngineNotice?: (notice: LocalNotice) => void,
    ): Promise<EnhancedChatMessage> => {
      try {
        let timingCheckpoint = performance.now();
        logger.info('Getting AI response for session:', sessionId);

        const latestMessage = messages[messages.length - 1];
        lastCombatSessionIdRef.current = sessionId;

        // Guard against repeated message processing
        const sig = `${sessionId}|${latestMessage.text}|${messages.length}`;
        if (lastSigRef.current === sig) {
          logger.debug('[useAIResponse] Skipping duplicate message processing for signature:', sig);
          return {
            text: '',
            sender: 'dm',
            timestamp: new Date().toISOString(),
            context: { emotion: 'neutral', intent: 'response' },
          };
        }
        lastSigRef.current = sig;

        // Clear processed roll requests on new player ACTION (not dice roll)
        const isDiceRollMessage = latestMessage.context?.intent === 'dice_roll';
        // Taking any other action is an answer to a waiting attack die too, and the answer is
        // "not this one". Settle it engine-rolled before this turn starts, so the pending
        // attack resolves instead of sitting behind a popup the player has visibly left. There
        // is deliberately no wall-clock timeout: a popup open overnight is a player who came
        // back, not a failure.
        if (!isDiceRollMessage && hasPendingPlayerRoll()) {
          logger.info('[PlayerRoll] superseded by a new player action; the engine rolls it');
          settlePendingPlayerRoll({ d20: null });
        }
        if (!isDiceRollMessage) {
          logger.debug('[useAIResponse] New player action - clearing processed roll requests');
          processedRollRequestsRef.current.clear();
        }

        // Log incoming dice roll results (delegated to session-logger)
        await logIncomingRolls(sessionId, latestMessage);

        // Combat truth for this turn is re-read from the server rather than taken from the last
        // render. Everything below — the tactical-context fetch, the combat flag the DM is told,
        // and structured action execution — reads these two locals, so a fight the server ended
        // on a killing blow (or started while this closure was already captured) is seen here.
        let activeEncounter = await refreshCombatState();
        logger.info('TURN_PREFLIGHT_TIMING', {
          sessionId,
          stage: 'incoming-roll-log-and-combat-refresh',
          ms: Math.round(performance.now() - timingCheckpoint),
        });
        timingCheckpoint = performance.now();
        let isInCombat = activeEncounter?.phase === 'active';

        // Detect if this is the first player message in the session
        const isFirstMessage = messages.filter((m) => m.sender === 'player').length <= 1;

        // ⚡ Bolt: Parallelize fetching game context, voice context, and relevant memories to reduce latency.
        // This reduces total request time by executing all context retrieval concurrently.
        const [gameContext, voiceContext, relevantMemories] = await Promise.all([
          fetchGameContext(sessionId).then((value) => {
            logger.info('TURN_PREFLIGHT_TIMING', {
              sessionId,
              stage: 'game-context',
              ms: Math.round(performance.now() - timingCheckpoint),
            });
            return value;
          }),
          voiceConsistencyService.getSessionVoiceContext(sessionId).then((value) => {
            logger.info('TURN_PREFLIGHT_TIMING', {
              sessionId,
              stage: 'voice-context',
              ms: Math.round(performance.now() - timingCheckpoint),
            });
            return value;
          }),
          MemoryManager.getRelevantMemories(sessionId, latestMessage.text, 8).then((value) => {
            logger.info('TURN_PREFLIGHT_TIMING', {
              sessionId,
              stage: 'relevant-memories',
              ms: Math.round(performance.now() - timingCheckpoint),
            });
            return value;
          }),
        ]);

        logger.info('TURN_PREFLIGHT_TIMING', {
          sessionId,
          stage: 'game-voice-memory-parallel',
          ms: Math.round(performance.now() - timingCheckpoint),
        });
        timingCheckpoint = performance.now();

        if (!gameContext) {
          throw new Error('Failed to fetch game context');
        }

        const characterRecord = gameContext.character as Record<string, unknown>;
        const characterId = String(characterRecord.id || '');
        lastCombatCharacterIdRef.current = characterId;
        lastCombatEncounterRef.current = activeEncounter;
        setCombatTurnUiState(
          combatTurnUiStateForEncounter(activeEncounter, isInCombat, characterId, 'running'),
        );

        const combatWasActiveAtRequestStart = isInCombat;
        let preflightNpcTurns: AdvanceNpcTurnsResponse | undefined;
        let npcLinesShown = false;
        if (isInCombat && !isDiceRollMessage) {
          // Read before the pre-flight: one that ends combat leaves no encounter to read after.
          const preflightParticipants = activeEncounter?.participants;
          try {
            const preflight = await preflightNpcTurnsBeforePlayerDeclaration({
              sessionId,
              activeEncounter,
              characterId,
              refreshCombatState,
            });
            activeEncounter = preflight.activeEncounter as typeof activeEncounter;
            isInCombat = preflight.isInCombat;
            preflightNpcTurns = preflight.npcTurns;
            lastCombatEncounterRef.current = activeEncounter;
            setCombatTurnUiState(
              combatTurnUiStateForEncounter(activeEncounter, isInCombat, characterId),
            );
          } catch (error) {
            logger.warn(COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED, {
              sessionId,
              encounterId: activeEncounter?.id ?? null,
              status: preflightErrorStatus(error),
            });
            // A failed pre-flight cannot safely send the declaration to the DM. Clear the
            // duplicate guard so the player can retry the same message after the NPC batch settles.
            lastSigRef.current = '';
            setCombatTurnUiState(
              combatTurnUiStateForEncounter(activeEncounter, true, characterId, 'unknown'),
            );
            return {
              text: '',
              sender: 'dm',
              timestamp: new Date().toISOString(),
              context: { emotion: 'neutral', intent: 'response' },
              localNotice: NPC_FIRST_ADVANCE_FAILED_NOTICE,
              localNotices: [{ text: NPC_FIRST_ADVANCE_FAILED_NOTICE, persist: true }],
            };
          }
          // The tracker HP has moved by now. Say why before the DM call and the player's die
          // prompt, not after them in the reply (#2386). Outside the try: the server advanced the
          // NPCs, so a failure here is not a failed advance.
          if (preflightNpcTurns && onEngineNotice) {
            showNpcTurnLines(preflightNpcTurns, preflightParticipants, onEngineNotice);
            npcLinesShown = true;
          }
        }

        logger.info('TURN_PREFLIGHT_TIMING', {
          sessionId,
          stage: 'npc-turns',
          ms: Math.round(performance.now() - timingCheckpoint),
        });
        timingCheckpoint = performance.now();

        // #2392: the sheet's Cast of a save spell asks the player before the DM is called; the
        // card needs no model output, and the DM's reply used to come first.
        await holdSaveCardBeforeDm({
          origin: playerInputOriginOf(latestMessage),
          spellId: latestMessage.context?.spellId,
          activeEncounter: isInCombat ? activeEncounter : null,
        });

        logger.info('TURN_PREFLIGHT_TIMING', {
          sessionId,
          stage: 'save-card-player-wait',
          ms: Math.round(performance.now() - timingCheckpoint),
        });
        timingCheckpoint = performance.now();

        logger.debug('Calling DM Agent with context:', {
          gameContext,
          knownCharacters: Object.keys(voiceContext.knownCharacters).length,
          isFirstMessage,
          combatDetected: isInCombat,
        });

        // Build conversation history for AIService
        const conversationHistory = conversationHistoryFrom(messages.slice(0, -1));

        // Create AI context with combat awareness
        const aiContext = buildAIContext({
          sessionId,
          userId: user?.id,
          starterCampaignId: gameContext.starterCampaignId,
          campaign: gameContext.campaign,
          character: gameContext.character,
          currentPhase: gameState.currentPhase,
          isInCombat,
          encounterId: activeEncounter?.id,
          currentTurnParticipantId: activeEncounter?.currentTurnParticipantId,
          pendingRollsCount: gameState.diceRollQueue.pendingRolls.length,
          currentRound: activeEncounter?.currentRound,
          participants: activeEncounter?.participants,
        });

        // The tactical server computes geometry. The DM receives only its bounded
        // ASCII/digest context and never derives distances or line of sight itself.
        if (isInCombat && sessionId && activeEncounter?.currentTurnParticipantId) {
          try {
            const tacticalResponse = await userDataApi.getTacticalMapContext(
              sessionId,
              activeEncounter.currentTurnParticipantId,
            );
            if (tacticalResponse.ok) {
              const payload = (await tacticalResponse.json()) as { tacticalContext?: string };
              if (payload.tacticalContext)
                aiContext.gameState.tacticalContext = payload.tacticalContext;
            }
          } catch (error) {
            logger.warn('Unable to load tactical context; continuing without map context', error);
          }
        }

        logger.debug('AI Context with combat awareness:', {
          phase: gameState.currentPhase,
          inCombat: isInCombat,
          pendingRolls: gameState.diceRollQueue.pendingRolls.length,
          currentTurn: activeEncounter?.currentTurnParticipantId,
        });

        logger.info('TURN_PREFLIGHT_TIMING', {
          sessionId,
          stage: 'history-context-and-tactical-fetch',
          ms: Math.round(performance.now() - timingCheckpoint),
        });
        timingCheckpoint = performance.now();
        onTurnPhase?.('preflight');

        // #2341: a message that names an attack on a creature, with no encounter open, asks the
        // player before the DM is called. The DM answering first is how a Chill Touch got
        // narrated as a miss with no roll (run 14). Strike goes to the engine below with no
        // DM text yet; "Do something else" calls the DM with a note that nothing happened.
        const heldEntry =
          !activeEncounter && !isDiceRollMessage
            ? await holdCombatEntryBeforeDm({
                sessionId,
                message: latestMessage.text,
                characterRecord,
                recentNarration: recentNarrationFrom(messages.slice(0, -1)),
              })
            : null;
        logger.info('TURN_PREFLIGHT_TIMING', {
          sessionId,
          stage: 'combat-entry-detection-and-player-wait',
          ms: Math.round(performance.now() - timingCheckpoint),
        });
        const entryDeclined = heldEntry?.decision === 'declined';
        if (heldEntry?.decision === 'declined') {
          aiContext.gameState.combatEntryDeclined = heldEntry.label;
        }
        const playerInputOrigin = playerInputOriginOf(latestMessage);
        // A declined entry's reply is checked as a plain narrative turn: its combat fields are
        // blanked below, whatever the model asked for. A turn that began in combat, or whose
        // pre-flight ran NPC turns, is never narrative: the pre-flight can end the fight and
        // clear `isInCombat`, and the DM is then describing the engine's own hits.
        const narrativeTurnOf = (reply: AIResponse): NarrativeTurn => ({
          isInCombat:
            isInCombat ||
            combatWasActiveAtRequestStart ||
            Boolean(preflightNpcTurns?.results?.length || preflightNpcTurns?.combatEnded),
          isDiceRollMessage: !!isDiceRollMessage,
          playerInputOrigin,
          result: entryDeclined ? { text: reply.text } : reply,
        });
        // Only a turn that could end up gated parks its memory and world writes; the rest write
        // as they always did.
        const holdSideEffects = narrativeTurnHasNoEngineEvent(narrativeTurnOf({ text: '' }));
        const askDm =
          heldEntry && heldEntry.decision !== 'declined'
            ? async () => heldEntryResult(heldEntry.pending)
            : AIService.chatWithDM;

        // Call AIService
        let result = await askDm({
          message: latestMessage.text,
          context: aiContext,
          conversationHistory,
          userPlan: userPlan || undefined,
          turnCount,
          relevantMemories,
          onTurnPhase,
          ...(holdSideEffects ? { holdSideEffects } : {}),
          // #2218: the server persists a display-ready reply under the id the caller reserved.
          // `inCombat` carries the same combat-sequence test the early render uses below, so
          // the server never keeps prose for a turn the engine may still resolve.
          ...(dmMessageId
            ? {
                dmReply: {
                  messageId: dmMessageId,
                  inCombat: Boolean(
                    isInCombat ||
                    preflightNpcTurns?.results?.length ||
                    preflightNpcTurns?.combatEnded,
                  ),
                  // The client's own gate predicate, so the server's harm check stands down on
                  // exactly the turns the client gate does (a dice-roll message, say).
                  narrationGated: holdSideEffects,
                },
              }
            : {}),
          ...(onTextReady
            ? {
                onTextReady: async (parsedResult: AIResponse) => {
                  // A combat response is not display-ready until the authoritative player and
                  // NPC sequence has been resolved. Rendering this speculative DM text early lets
                  // the delayed `/advance-npc-turns` response land after it in the transcript
                  // (#2127). Preflight can end combat and clear `isInCombat`, so its NPC turns
                  // are checked on their own.
                  const combatSequencePending = Boolean(
                    isInCombat ||
                    preflightNpcTurns?.results?.length ||
                    preflightNpcTurns?.combatEnded,
                  );
                  // A declined entry is not a combat turn: whatever the model asked for, no roll
                  // is prompted and no fight starts (#2341).
                  const earlyRollRequests = (
                    entryDeclined ? [] : parsedResult.roll_requests || []
                  ) as RollRequest[];
                  const earlyShouldStartCombat =
                    !entryDeclined &&
                    (!!parsedResult.combatDetection?.shouldStartCombat ||
                      parsedResult.combat_transition === 'start');
                  // The engine can still resolve this turn after the text is parsed:
                  // `requestPlayerAttackRoll` and combat resolution both run inside
                  // `handleDmActionsAndTransitions`, which executes after this callback. Rendering
                  // the declaration prose first shows an outcome the dice have not decided yet
                  // (#2139), so any turn the engine may resolve suppresses the early render.
                  // Non-combat, non-roll turns keep it (the #2095 fast-render win).
                  // A narrative reply the gate below would reject is not shown first (#2373); a
                  // clean one keeps the early render.
                  const earlyGateMayReject =
                    narrativeTurnHasNoEngineEvent(narrativeTurnOf(parsedResult)) &&
                    suspectsFabricatedOutcome(parsedResult.text, { playerMayHaveActed: true });
                  const suppressRender =
                    combatSequencePending ||
                    earlyShouldStartCombat ||
                    earlyRollRequests.length > 0 ||
                    earlyGateMayReject;
                  // Combat turns hand their roll requests to the engine, not to the dice popup
                  // (#2190). Only a narrative roll turn outside combat may prompt early.
                  const earlyRollPromptAllowed =
                    earlyRollRequests.length > 0 &&
                    !combatSequencePending &&
                    !earlyShouldStartCombat;
                  let earlyText = parsedResult.text;
                  if (!suppressRender && parsedResult.options?.length) {
                    earlyText = `${earlyText.trim()}\n\n${parsedResult.options.join('\n')}`;
                  }

                  await onTextReady(
                    {
                      text: earlyText,
                      sender: 'dm',
                      timestamp: new Date().toISOString(),
                      context: {
                        emotion: 'neutral',
                        intent: 'response',
                        combat_transition: parsedResult.combat_transition ?? 'none',
                        scene_spec: parsedResult.scene_spec != null,
                      },
                      narrationSegments: parsedResult.narrationSegments,
                      diceRolls: (parsedResult.dice_rolls || []) as DiceRoll[],
                      rollRequests: earlyRollRequests,
                      sceneSpec: (parsedResult.scene_spec as SceneSpec | null | undefined) ?? null,
                      combatDetection: {
                        isCombat: parsedResult.combatDetection?.isCombat || false,
                        confidence: parsedResult.combatDetection?.confidence || 1,
                        combatType: parsedResult.combatDetection?.combatType || 'none',
                        shouldStartCombat: earlyShouldStartCombat,
                        shouldEndCombat: !!parsedResult.combatDetection?.shouldEndCombat,
                        enemies: parsedResult.combatDetection?.enemies || [],
                        combatActions: parsedResult.combatDetection?.combatActions || [],
                      },
                    },
                    { suppressRender, earlyRollPromptAllowed },
                  );
                },
              }
            : {}),
        });

        if (entryDeclined) {
          // The prompt already says nothing happened; this is the half that does not depend on the
          // model complying, the same blanking the handler's own decline branch does.
          result = {
            ...result,
            combat_transition: 'none',
            combat_entry_pending: undefined,
            combat_actions: [],
            map_actions: [],
            roll_requests: [],
            ...(result.combatDetection
              ? { combatDetection: { ...result.combatDetection, shouldStartCombat: false } }
              : {}),
          };
        }

        // #2373: outside combat, a turn with no roll, no dice result and no combat declaration has
        // no engine line, so the reply is the only account of it. One that claims harm is asked
        // for again with the violation named, then replaced. The in-combat twin of this check is
        // in combat-resolution-step.ts, and both go through `enforceNarrationGate`.
        if (narrativeTurnHasNoEngineEvent(narrativeTurnOf(result))) {
          result = (
            await enforceNarrationGate({
              narration: result,
              sessionId,
              branch: 'narrative',
              playerMayHaveActed: true,
              regenerate: (violation) =>
                AIService.chatWithDM({
                  message: latestMessage.text,
                  narrationViolation: violation,
                  holdSideEffects: true,
                  context: aiContext,
                  conversationHistory,
                  userPlan: userPlan || undefined,
                  turnCount,
                  relevantMemories,
                }),
            })
          ).narration;
        } else {
          releaseHeldSideEffects(result);
        }

        // Extract response data (result type has both snake_case and camelCase variants)
        let responseText = result.text;
        let narrationSegments = result.narrationSegments;
        const diceRolls = (result.dice_rolls || []) as DiceRoll[];
        const imageRequests: ImageRequest[] | undefined = undefined;

        // Process DM Actions and transitions
        const dmActionsResult = await handleDmActionsAndTransitions({
          sessionId,
          result,
          characterRecord,
          activeEncounter,
          isInCombat,
          refreshCombatState,
          aiContext,
          conversationHistory,
          preflightNpcTurns,
          combatRound: activeEncounter?.currentRound,
          userPlan: userPlan || undefined,
          turnCount,
          playerMessage: latestMessage.text,
          isDiceRollMessage: !!isDiceRollMessage,
          playerInputOrigin,
          entryConfirmed: heldEntry?.decision === 'confirmed',
          onEngineNotice,
          npcLinesShown,
        });

        result = dmActionsResult.result;
        responseText = dmActionsResult.responseText;
        narrationSegments = dmActionsResult.narrationSegments;
        const deliveredHandouts = dmActionsResult.deliveredHandouts;
        isInCombat = dmActionsResult.isInCombat;
        activeEncounter = dmActionsResult.activeEncounter;
        const localNotice = dmActionsResult.localNotice;
        const localNotices = dmActionsResult.localNotices;
        const combatEngineBlocks = (
          result as AIResponse & { combatEngineBlocks?: CombatEngineBlock[] }
        ).combatEngineBlocks;

        // Combat resolution and the autonomous NPC loop advance the server outside the browser
        // reducer. Re-read that truth before returning control to the UI so a player handoff is
        // reflected in both the composer and the action panel in the same turn.
        if (sessionId && isInCombat) {
          const reconciliation = await reconcileCombatTurnAfterAction({
            sessionId,
            activeEncounter,
            characterId,
            refreshCombatState,
          });
          activeEncounter = reconciliation.activeEncounter as typeof activeEncounter;
          isInCombat = reconciliation.isInCombat;
          lastCombatEncounterRef.current = activeEncounter;
          setCombatTurnUiState(reconciliation.uiState);
        } else {
          lastCombatEncounterRef.current = activeEncounter;
          setCombatTurnUiState(
            combatTurnUiStateForEncounter(activeEncounter, isInCombat, characterId),
          );
        }

        // The engine may have ended combat during this turn. The roll drop reads this flag, and it
        // was set when the context was built, so a check the DM asks for after the killing blow
        // would be dropped as an in-combat request (#2386).
        aiContext.gameState.isInCombat = isInCombat;

        // Process roll requests (parse, deduplicate, execute NPC rolls)
        const processedRolls = await processRollRequests({
          responseText,
          existingRequests: result.roll_requests || [],
          isDiceRollMessage: !!isDiceRollMessage,
          processedSet: processedRollRequestsRef.current,
          aiContext,
          sessionId,
          characterId: (characterRecord.id as string) || 'player',
        });

        // Log outgoing roll requests off the critical path; the processed requests themselves
        // already gate the dice UI and composer state below.
        runDeferredTask('roll request logging', () =>
          logRollRequests(sessionId, processedRolls.playerRollRequests),
        );

        // Update game phase based on combat detection (delegated to game-phase-updater)
        updateGamePhase({
          combatDetection: result.combatDetection,
          currentPhase: gameState.currentPhase,
          isInCombat,
          setGamePhase,
        });

        // Voice mapping is useful, but it must not delay text or combat/roll gating.
        if (narrationSegments && narrationSegments.length > 0) {
          logger.info(
            'Received structured response with',
            narrationSegments.length,
            'narration segments',
          );
          runDeferredTask('voice assignment', async () => {
            await voiceConsistencyService.processVoiceAssignments(
              sessionId,
              stripEngineGeneratedLinesFromSegments(narrationSegments),
            );
            logger.info('Processed voice assignments successfully');
          });
        } else {
          logger.info('Received text-only response');
        }

        // Clamp combat intent flags (delegated to game-phase-updater)
        const { shouldStartCombat, shouldEndCombat } = clampCombatIntentFlags(
          !!result.combatDetection?.shouldStartCombat,
          !!result.combatDetection?.shouldEndCombat,
          isInCombat,
        );

        // Append NPC roll continuation to response text
        let finalResponseText = responseText;
        if (processedRolls.npcRollContinuationText) {
          finalResponseText = `${responseText}\n\n${processedRolls.npcRollContinuationText}`;
          logger.info('Appended NPC roll continuation to response');
        }

        // A reply with a narrative roll pending is not shown until the player rolls, and its
        // engine lines are the facts that explain the tracker. Show them now, once, rather than
        // behind the popup: the roll that survives on a combat-ending turn would otherwise hold
        // the kill line back (#2386).
        let replyEngineBlocks = combatEngineBlocks;
        if (
          processedRolls.playerRollRequests.some(isNarrativeRollRequest) &&
          onEngineNotice &&
          combatEngineBlocks?.length
        ) {
          const engineText = combatEngineBlocks
            .flatMap((block) => block.lines)
            .filter(Boolean)
            .join('\n\n');
          if (engineText && finalResponseText.startsWith(engineText)) {
            onEngineNotice({ text: engineText, persist: true });
            finalResponseText = finalResponseText.slice(engineText.length).trimStart();
            replyEngineBlocks = undefined;
          } else if (engineText) {
            // The reply does not lead with its engine lines, so they stay in it, behind the roll.
            logger.warn('ENGINE_LINES_STRIP_SKIPPED', { sessionId });
          }
        }

        // Guarantee clickable options on ordinary narrative turns. Combat turns
        // render server-provided legal actions, and roll-request turns pause on
        // the dice UI, so both are excluded.
        if (
          !isInCombat &&
          !shouldStartCombat &&
          result.combat_transition !== 'start' &&
          processedRolls.playerRollRequests.length === 0
        ) {
          if (result.options?.length) {
            finalResponseText = `${finalResponseText.trim()}\n\n${result.options.join('\n')}`;
          } else {
            runDeferredTask('action options', async () => {
              await ensureActionOptions(finalResponseText);
            });
          }
        }

        // Format the response as an EnhancedChatMessage
        return {
          text: finalResponseText,
          sender: 'dm',
          timestamp: new Date().toISOString(),
          context: {
            emotion: 'neutral',
            intent: 'response',
            combat_transition: result.combat_transition ?? 'none',
            scene_spec: result.scene_spec != null,
            npcRollResults:
              processedRolls.npcRollResults.length > 0 ? processedRolls.npcRollResults : undefined,
            handouts: deliveredHandouts,
            combatEngineBlocks: replyEngineBlocks,
            combatEnded: combatWasActiveAtRequestStart && !isInCombat,
          },
          narrationSegments,
          diceRolls,
          rollRequests: processedRolls.playerRollRequests,
          imageRequests,
          localNotice,
          localNotices,
          sceneSpec: (result.scene_spec as SceneSpec | null | undefined) ?? null,
          combatDetection: {
            isCombat: result.combatDetection?.isCombat || false,
            confidence: result.combatDetection?.confidence || 1,
            combatType: result.combatDetection?.combatType || 'none',
            shouldStartCombat,
            shouldEndCombat,
            enemies: result.combatDetection?.enemies || [],
            combatActions: result.combatDetection?.combatActions || [],
          },
        };
      } catch (error) {
        logger.error('Error in getAIResponse:', error);
        throw error;
      }
    },
    [
      gameState.currentPhase,
      gameState.diceRollQueue.pendingRolls.length,
      refreshCombatState,
      userPlan,
      user?.id,
      setGamePhase,
    ],
  );

  return { getAIResponse, combatTurnUiState, resumeCombatTurn };
};
