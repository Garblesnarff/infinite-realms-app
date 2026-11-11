// External/SDK Imports
import { useRef, useCallback, useState } from 'react';

import type { SceneSpec } from '../../../server-bun/src/tactical/types';
import type { LocalNotice } from '@/hooks/ai/types';
import type { TurnPhaseReporter } from '@/infrastructure/api/rest-client';
import type { AIResponse } from '@/services/ai-service';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { CombatEngineBlock } from '@/utils/combat-engine-blocks';
import type { DetectedEnemy, DetectedCombatAction } from '@/utils/combatDetection';

import { useAuth } from '@/contexts/AuthContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { isEngineTaggedRoll } from '@/contexts/game/dice-queue-visibility';
import { useGame } from '@/contexts/GameContext';
import { fetchGameContext, buildAIContext } from '@/hooks/ai/ai-utils';
import {
  heldEntryResult,
  holdCombatEntryBeforeDm,
  recentNarrationFrom,
} from '@/hooks/ai/combat-entry-hold';
import {
  SPELL_CAST_CANCELLED_NOTICE,
  combatTurnErrorMessage,
  combatTurnUiStateForEncounter,
  INITIAL_COMBAT_TURN_UI_STATE,
  playerParticipantForCharacter,
  preflightErrorStatus,
  reconcileCombatTurnAfterAction,
  type CombatTurnUiState,
} from '@/hooks/ai/combat-turn-preflight';
import { conversationHistoryFrom } from '@/hooks/ai/conversation-history';
import { handleDmActionsAndTransitions } from '@/hooks/ai/dm-actions-handler';
import { DYING_ACTION_REFUSED_NOTICE, dyingTurnDeclaration } from '@/hooks/ai/dying-turn';
import { updateGamePhase, clampCombatIntentFlags } from '@/hooks/ai/game-phase-updater';
import {
  enforceNarrationGate,
  gateRollOutcomeContradiction,
  narrativeTurnHasNoEngineEvent,
  playerPickedListedOption,
  releaseHeldSideEffects,
  type NarrativeTurn,
} from '@/hooks/ai/narration-gate';
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { logIncomingRolls, logRollRequests } from '@/hooks/ai/session-logger';
import { suspectsFabricatedOutcome } from '@/hooks/ai/silent-player-turn';
import { isTypedEndTurn } from '@/hooks/ai/typed-end-turn';
import logger from '@/lib/logger';
import {
  extractSheetCombatNames,
  filterOptionsAgainstSheet,
  optionList,
} from '@/services/ai/sheet-option-filter';
import { AIService, isRollOutcomeStale } from '@/services/ai-service';
import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';
import { playerInputOriginOf } from '@/services/combat/combat-action-origin';
import { consumeCombatEntryTypedAnswer } from '@/services/combat/combat-entry-confirmation-bridge';
import {
  clearCombatEntryTurnConfirmed,
  markCombatEntryTurnConfirmed,
} from '@/services/combat/combat-entry-delivery';
import { participantVital } from '@/services/combat/participant-vital';
import {
  hasPendingPlayerRoll,
  isNarrativeRollCommitted,
  pendingPlayerRollLabel,
  settleDeathSaveRoll,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';
import { sheetCastSignal } from '@/services/combat/sheet-cast-progress';
import { holdSaveCardBeforeDm } from '@/services/combat/sheet-cast-save-hold';
import { MemoryManager } from '@/services/memory-manager';
import { SessionStateService } from '@/services/session-state-service';
import { fetchSessionTrackers } from '@/services/session-trackers';
import { userDataApi } from '@/services/user-data-api';
import { voiceConsistencyService } from '@/services/voice-consistency-service';
import { messagesSupersededByCombatEnd } from '@/utils/combat-engine-blocks';
import { stripEngineGeneratedLinesFromSegments } from '@/utils/engine-lines';
import { ensureActionOptions } from '@/utils/ensure-action-options';
import { isNarrativeRollRequest, loggableRollType } from '@/utils/roll-request/engine-channel';

// Voice narration types
export interface NarrationSegment {
  type: 'narration' | 'dialogue' | 'action' | 'thought' | 'dm' | 'character' | 'transition';
  text: string;
  character?: string;
  voice_category?: string;
  npc_id?: string;
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

// #919: a session whose most recent combat still owes the DM its ending facts
// (who died, why the fight stopped) is marked in sessionStorage. The facts sit on
// the concluded board and are served by the tactical-context GET, but the
// encounter itself is already cleared by the first post-combat turn, so the turn
// code below keeps fetching for a marked session until a fetch actually delivers
// them. Storage, not a hook ref: the game tree remounts per session, and a
// remount between the last in-combat turn and the first post-combat one must not
// lose the mark. Storage can be unavailable (privacy modes); the mark then
// simply never persists and the post-combat fetch does not happen.
const COMBAT_END_FACTS_PENDING_KEY = 'ir:combat-end-facts-pending:';

/**
 * The engine's final lines for the fallen screen: the last round's lines only,
 * at most three, newest last. Rows without a round all count as one round.
 */
function finalRoundLines(
  rows: ReadonlyArray<{ text: string; round?: number }>,
  limit = 3,
): string[] {
  const last = rows[rows.length - 1];
  if (!last) return [];
  return rows
    .filter((row) => row.round === last.round)
    .map((row) => row.text.trim())
    .filter(Boolean)
    .slice(-limit);
}

function markCombatEndFactsPending(sessionId: string): void {
  try {
    window.sessionStorage.setItem(COMBAT_END_FACTS_PENDING_KEY + sessionId, '1');
  } catch {
    // Storage unavailable: the mark is best-effort by design.
  }
}

function combatEndFactsPending(sessionId: string): boolean {
  try {
    return window.sessionStorage.getItem(COMBAT_END_FACTS_PENDING_KEY + sessionId) === '1';
  } catch {
    return false;
  }
}

function clearCombatEndFactsPending(sessionId: string): void {
  try {
    window.sessionStorage.removeItem(COMBAT_END_FACTS_PENDING_KEY + sessionId);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

type TurnAbortSignal = AbortSignal & {
  onPlayerWaitChange?: (waiting: boolean) => void;
};

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

function rejectWhenAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException('The request was aborted.', 'AbortError'));
  }
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('The request was aborted.', 'AbortError')),
        { once: true },
      );
    }),
  ]);
}

function runDeferredTask(
  label: string,
  task: (signal?: AbortSignal) => Promise<unknown>,
  signal?: AbortSignal,
): void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${DEFERRED_TASK_TIMEOUT_MS}ms`)),
      DEFERRED_TASK_TIMEOUT_MS,
    );
  });

  const abort = signal
    ? new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new DOMException('The request was aborted.', 'AbortError'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('The request was aborted.', 'AbortError')),
          { once: true },
        );
      })
    : null;

  void Promise.race([
    Promise.resolve().then(() => {
      if (signal?.aborted) return;
      return task(signal);
    }),
    timeout,
    ...(abort ? [abort] : []),
  ])
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
    signal?: AbortSignal,
    /**
     * #633 PR2: progressive DM narration chunks, in order, while the turn
     * streams. The hook forwards them to `AIService.chatWithDM`; the caller
     * renders them (the authoritative final text still flows through the
     * existing path).
     */
    onStreamChunk?: (chunk: string) => void,
    onStreamReset?: () => void,
  ) => Promise<EnhancedChatMessage>;
  combatTurnUiState: CombatTurnUiState;
  resumeCombatTurn: () => Promise<void>;
  terminalDeathState: {
    state: 'party_defeated';
    encounterId: string | null;
    receivedAt: number;
    /** The engine's final lines for the fallen character, when this turn produced them. */
    finalLines?: string[];
  } | null;
  /**
   * #1020: the campaign's ending landed this turn — the server completed the
   * session in /generate and kept the `campaign_ending` field on the reply.
   * While set, the UI renders the completion end state.
   */
  campaignCompletedState: {
    /** The ending's summary, as declared by the DM and stored as the session summary. */
    summary: string;
    /** The session this ending belongs to; the screen renders it only for that session. */
    sessionId: string;
    /** When this completion arrived; distinguishes repeat arrivals. */
    receivedAt: number;
  } | null;
  /**
   * #2517: restore the death screen for a session that already ended in
   * defeat (page load / reconnect). Resolves true when the screen is shown.
   */
  checkRestoredDefeat: (sessionId: string) => Promise<boolean>;
} => {
  const { setGamePhase, state: gameState, cancelDiceRoll } = useGame();
  const { refreshCombatState } = useCombat();
  const { user, userPlan } = useAuth();
  // #400: the owned character sheet (equipment/spells) for the suggestion filter. The
  // session context's character payload is identity+stats only, so it cannot source this.
  const { state: characterState } = useCharacter();
  const [combatTurnUiState, setCombatTurnUiState] = useState<CombatTurnUiState>(
    INITIAL_COMBAT_TURN_UI_STATE,
  );
  /**
   * #2456: the server reported a handled terminal game state (the party was
   * defeated) instead of a DM reply. While set, the UI renders the death
   * screen with the player's choices instead of the chat input.
   */
  const [terminalDeathState, setTerminalDeathState] = useState<{
    state: 'party_defeated';
    encounterId: string | null;
    /** When this terminal response arrived; distinguishes repeat arrivals. */
    receivedAt: number;
    /** The engine's final lines for the fallen character, when this turn produced them. */
    finalLines?: string[];
  } | null>(null);
  /**
   * #1020: the campaign's ending landed — the server completed the session in
   * /generate (story-ending.ts) and kept the reply's `campaign_ending` field,
   * which it nulls whenever the ending did not apply. While set, the UI
   * renders the completion end state instead of the composer.
   */
  const [campaignCompletedState, setCampaignCompletedState] = useState<{
    summary: string;
    sessionId: string;
    receivedAt: number;
  } | null>(null);
  const terminalDeathSessionRef = useRef<string>('');
  // The queue as of the latest render: a turn started from a stale closure must not cancel a roll
  // the player has already answered.
  const diceRollQueueRef = useRef(gameState.diceRollQueue);
  diceRollQueueRef.current = gameState.diceRollQueue;
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
   * #2517: on session load (and reconnect), ask the server whether this
   * session's character has fallen and restore the end state. The truth is
   * `character_stats.vital_state` in the session load payload, not the
   * encounter row. Switching to a different session clears a previous
   * session's screen first.
   */
  const checkRestoredDefeat = useCallback(async (sessionId: string): Promise<boolean> => {
    if (!sessionId) return false;
    if (terminalDeathSessionRef.current !== sessionId) {
      terminalDeathSessionRef.current = sessionId;
      setTerminalDeathState(null);
      // #1020: a previous session's completion screen must not follow the player
      // into a different session either.
      setCampaignCompletedState(null);
    }
    try {
      const fallen = await userDataApi.fetchSessionFallenState(sessionId);
      if (!fallen) return false;
      setTerminalDeathState({
        state: 'party_defeated',
        encounterId: null,
        receivedAt: Date.now(),
      });
      return true;
    } catch (error) {
      logger.warn('TERMINAL_STATE_RESTORE_FAILED', {
        sessionId,
        status: preflightErrorStatus(error),
      });
      return false;
    }
  }, []);

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
      signal?: AbortSignal,
      onStreamChunk?: (chunk: string) => void,
      onStreamReset?: () => void,
    ): Promise<EnhancedChatMessage> => {
      try {
        let timingCheckpoint = performance.now();
        logger.info('Getting AI response for session:', sessionId);

        const latestMessage = messages[messages.length - 1];
        // #400: consume eagerly at turn start, so a turn that fails before the entry hold
        // does not leak the flag to a later unrelated turn. The skip applies only when this
        // turn's message is the one typed while the card was up.
        const typedEntryAnswer = consumeCombatEntryTypedAnswer(latestMessage.text);
        const turnSignal = signal as TurnAbortSignal | undefined;
        const awaitPlayerInput = async <T>(promise: Promise<T>): Promise<T> => {
          turnSignal?.onPlayerWaitChange?.(true);
          try {
            return await rejectWhenAborted(promise, signal);
          } finally {
            turnSignal?.onPlayerWaitChange?.(false);
          }
        };
        const throwIfAborted = (): void => {
          if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
        };
        throwIfAborted();
        lastCombatSessionIdRef.current = sessionId;

        // Guard against repeated message processing. The history the player's message sits on is
        // part of its identity: the loaded message window is capped (PAGE_SIZE), so past the cap
        // `messages.length` is the same on every turn, and the same words typed twice in a row
        // were taken for one turn and silently skipped, with no request sent and no UI (#2530).
        const previousRow = messages[messages.length - 2];
        const sig = `${sessionId}|${latestMessage.text}|${messages.length}|${
          previousRow?.id ?? ''
        }|${previousRow?.sequenceNumber ?? ''}|${previousRow?.timestamp ?? ''}`;
        if (lastSigRef.current === sig) {
          logger.warn('DUPLICATE_PLAYER_TURN_SKIPPED', {
            sessionId,
            messageCount: messages.length,
          });
          return {
            text: '',
            sender: 'dm',
            timestamp: new Date().toISOString(),
            context: { emotion: 'neutral', intent: 'response' },
          };
        }
        lastSigRef.current = sig;
        // An aborted turn must not poison the duplicate guard. Otherwise an explicit retry with
        // the same text is mistaken for the late result of the timed-out turn and returns before
        // combat resolution can run again.
        signal?.addEventListener(
          'abort',
          () => {
            if (lastSigRef.current === sig) lastSigRef.current = '';
          },
          { once: true },
        );

        // Clear processed roll requests on new player ACTION (not dice roll)
        const isDiceRollMessage = latestMessage.context?.intent === 'dice_roll';
        // Taking any other action is an answer to a waiting attack die too, and the answer is
        // "not this one". Settle it engine-rolled before this turn starts, so the pending
        // attack resolves instead of sitting behind a popup the player has visibly left. There
        // is deliberately no wall-clock timeout: a popup open overnight is a player who came
        // back, not a failure.
        if (!isDiceRollMessage && hasPendingPlayerRoll()) {
          const label = pendingPlayerRollLabel();
          logger.info('[PlayerRoll] superseded by a new player action; the engine rolls it');
          // #261 CB-025: a death-save prompt settles through its own named path, never the
          // generic attack-roll settle.
          if (!settleDeathSaveRoll({ d20: null })) settlePendingPlayerRoll({ d20: null });
          onEngineNotice?.({
            text: `Your ${label ?? 'combat'} roll was rolled for you because you took another action.`,
            persist: true,
          });
        }
        // A narrative roll the DM asked for (a skill check, a save) that is still unanswered
        // when the player takes another action is set aside the same way, and the player is told.
        // Nothing in the send pipeline waits on it (#2530). A retry of an unanswered turn is not
        // another action, and a die the player has already thrown is not set aside.
        if (!isDiceRollMessage && latestMessage.context?.intent !== 'resume_unanswered') {
          for (const roll of diceRollQueueRef.current.pendingRolls) {
            if (
              roll.status !== 'pending' ||
              isEngineTaggedRoll(roll) ||
              isNarrativeRollCommitted(roll.id)
            ) {
              continue;
            }
            logger.warn('DM_ROLL_REQUEST_CANCELLED', {
              reason: 'superseded_by_player_action',
              type: loggableRollType(roll.requestType),
            });
            cancelDiceRoll(roll.id);
            onEngineNotice?.({
              text: `Your ${roll.description} roll was set aside because you took another action.`,
              persist: true,
            });
          }
        }
        if (!isDiceRollMessage) {
          logger.debug('[useAIResponse] New player action - clearing processed roll requests');
          processedRollRequestsRef.current.clear();
        }

        // Log incoming dice roll results (delegated to session-logger)
        await rejectWhenAborted(logIncomingRolls(sessionId, latestMessage), signal);

        // Combat truth for this turn is re-read from the server rather than taken from the last
        // render. Everything below — the tactical-context fetch, the combat flag the DM is told,
        // and structured action execution — reads these two locals, so a fight the server ended
        // on a killing blow (or started while this closure was already captured) is seen here.
        let activeEncounter = await rejectWhenAborted(refreshCombatState(signal), signal);
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
        const [gameContext, voiceContext, relevantMemories] = await rejectWhenAborted(
          Promise.all([
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
          ]),
          signal,
        );

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
        // #400: the DM's suggested options are filtered against the owned sheet —
        // an option naming a spell or attack the character cannot use never reaches the
        // screen. Without a sheet the filter is a no-op: filtering against an empty sheet
        // would drop legitimate suggestions.
        const sheetCombatNames = extractSheetCombatNames(
          characterState.character as Record<string, unknown> | null,
        );
        const filterSheetOptions = (options: unknown[]): unknown[] =>
          sheetCombatNames ? filterOptionsAgainstSheet(options, sheetCombatNames) : options;

        // A character on the floor cannot act (SRD 5.1): the one thing their turn holds is the
        // death saving throw, which the dying panel's driver sends as `death_save_turn`. Any other
        // message is refused here with the reason — no DM turn, no engine call. A dice result for
        // a narrative check is not an action and passes.
        const dyingPlayer = isInCombat
          ? playerParticipantForCharacter(activeEncounter, characterId)
          : undefined;
        const isDyingTurn = latestMessage.context?.intent === 'death_save_turn';
        const playerIsDying = Boolean(dyingPlayer && participantVital(dyingPlayer) === 'dying');
        if (playerIsDying && !isDyingTurn && !isDiceRollMessage) {
          logger.info('DYING_ACTION_REFUSED', { sessionId });
          setCombatTurnUiState(
            combatTurnUiStateForEncounter(activeEncounter, isInCombat, characterId),
          );
          return {
            text: '',
            sender: 'dm',
            timestamp: new Date().toISOString(),
            context: { emotion: 'neutral', intent: 'response' },
            localNotice: DYING_ACTION_REFUSED_NOTICE,
            localNotices: [{ text: DYING_ACTION_REFUSED_NOTICE, persist: true }],
          };
        }

        const playerInputOrigin = playerInputOriginOf(latestMessage);

        // #784: a typed message that is nothing but an end-of-turn takes the End turn intent,
        // before the DM is called. The DM model cannot emit `end_turn` (the `combat_actions`
        // vocabulary has no such action type), so routing the phrase through it produced "that was
        // not a combat action" and left the turn open. This is the same intent the button posts,
        // and the server writes the boundary row and the creatures that follow onto the response
        // (#2658).
        const endTurnPlayer =
          isInCombat && playerInputOrigin === 'typed'
            ? playerParticipantForCharacter(activeEncounter, characterId)
            : undefined;
        if (
          endTurnPlayer &&
          activeEncounter?.id &&
          activeEncounter.currentTurnParticipantId === endTurnPlayer.id &&
          isTypedEndTurn(latestMessage.text)
        ) {
          await executeAuthoritativeCombatIntent(activeEncounter.id, {
            type: 'end_turn',
            actorId: endTurnPlayer.id,
            actionId: crypto.randomUUID(),
          });
          await rejectWhenAborted(refreshCombatState(signal), signal);
          setCombatTurnUiState(
            combatTurnUiStateForEncounter(activeEncounter, isInCombat, characterId),
          );
          return {
            text: '',
            sender: 'dm',
            timestamp: new Date().toISOString(),
            context: { emotion: 'neutral', intent: 'response' },
          };
        }

        setCombatTurnUiState(
          combatTurnUiStateForEncounter(activeEncounter, isInCombat, characterId, 'running'),
        );

        const combatWasActiveAtRequestStart = isInCombat;

        /** The turn is withdrawn: no DM text, one notice, and the turn state reads as settled. */
        const castCancelledReply = (notice: string): EnhancedChatMessage => {
          setCombatTurnUiState(
            combatTurnUiStateForEncounter(activeEncounter, isInCombat, characterId),
          );
          return {
            text: '',
            sender: 'dm',
            timestamp: new Date().toISOString(),
            context: { emotion: 'neutral', intent: 'response' },
            localNotice: notice,
            localNotices: [{ text: notice, persist: true }],
          };
        };

        // #2392: the sheet's Cast of a save spell asks the player before the DM is called; the
        // card needs no model output, and the DM's reply used to come first.
        const heldSave = await awaitPlayerInput(
          holdSaveCardBeforeDm({
            origin: playerInputOriginOf(latestMessage),
            spellId: latestMessage.context?.spellId,
            activeEncounter: isInCombat ? activeEncounter : null,
          }),
        );
        // Cancel cast (#2418): the DM was never called and the engine spent nothing.
        if (heldSave === 'cancelled') return castCancelledReply(SPELL_CAST_CANCELLED_NOTICE);

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
          currentSceneDescription: gameContext.currentSceneDescription,
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
        //
        // #919: the fetch also runs on the first turn AFTER a combat this session
        // has seen. The ending facts are recorded on the concluded board and the
        // route serves them with no board left, but `refreshCombatState` has
        // already cleared the encounter by then, so an in-combat-only gate never
        // delivers them — the DM narrates from its pre-kill picture and offers
        // attacks on the dead (Hark D2-006). The entity id only centres the board
        // digest; with no board left a placeholder goes in its place, exactly as
        // the headless client passes on its post-combat turn.
        if (isInCombat && sessionId) markCombatEndFactsPending(sessionId);
        const postCombatFactsPending =
          !isInCombat && sessionId ? combatEndFactsPending(sessionId) : false;
        const tacticalEntityId = isInCombat
          ? activeEncounter?.currentTurnParticipantId
          : postCombatFactsPending
            ? '-'
            : undefined;
        if (sessionId && tacticalEntityId) {
          try {
            const tacticalRequest = signal
              ? userDataApi.getTacticalMapContext(sessionId, tacticalEntityId, signal)
              : userDataApi.getTacticalMapContext(sessionId, tacticalEntityId);
            const tacticalResponse = await rejectWhenAborted(tacticalRequest, signal);
            if (!tacticalResponse.ok && postCombatFactsPending) {
              // The route answers 404 only when no board is left and nothing is
              // pending on it: the ending facts are spent, so stop asking.
              clearCombatEndFactsPending(sessionId);
            }
            if (tacticalResponse.ok) {
              // #849: the delivery token travels with the one-shot facts; ai-service
              // echoes it on the generate call so the server can confirm delivery
              // and finally delete the batch.
              const payload = (await tacticalResponse.json()) as {
                tacticalContext?: string;
                deliveryToken?: string;
              };
              if (payload.tacticalContext)
                aiContext.gameState.tacticalContext = payload.tacticalContext;
              if (payload.deliveryToken && aiContext.gameState)
                aiContext.gameState.tacticalDeliveryToken = payload.deliveryToken;
              // The ending facts are one-shot, and only a response that actually
              // carried them ends the post-combat fetching: an ok response with
              // neither context nor a delivery token means the board is still
              // there but nothing was pending on it yet, and the fight's ending
              // facts can still be recorded against it (#919).
              if (postCombatFactsPending && (payload.tacticalContext || payload.deliveryToken))
                clearCombatEndFactsPending(sessionId);
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
