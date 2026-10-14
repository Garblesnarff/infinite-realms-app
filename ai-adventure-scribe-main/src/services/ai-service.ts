import { generateCampaignDescription, generateCampaignName } from './ai/campaign-generator';
import { ContextBuilder } from './ai/context-builder';
import {
  processDMResponse,
  processDMResponseSideEffects,
  runDeferredDMResponseWork,
} from './ai/dm-response-processor';
import { trackDmWait } from './ai/dm-wait';
import { enforceNarrationContract } from './ai/narration-contract-check';
import {
  assembleUserPrompt,
  buildSceneKey,
  buildSystemPrompt,
  buildTurnFlagsLine,
  extractCampaignDetails,
  sceneLoreCache,
  SECURITY_RULES_BASE_TEXT,
} from './ai/prompt-assembly';
import { CampaignContextPrompts } from './ai/prompts/campaign-context-prompts';
import {
  GameContextPrompts,
  resolveStarterCampaignId,
} from './ai/prompts/game-context-prompts';
import { formatConversationHistoryMessage } from './ai/shared/conversation-history';
import { measurePromptSections } from './ai/shared/prompt-metrics';
import {
  approximateTokens,
  DM_CANON_TOKEN_CAP,
  DM_HISTORY_MAX_MESSAGES,
  DM_HISTORY_TOKEN_FLOOR,
  DM_PROMPT_TOKEN_BUDGET,
  DM_TURN_CANON_ENTITY_TOKEN_BUDGET,
  selectRecentMessagesWithinTokenBudget,
} from './ai/shared/token-budget';
import { buildCombatEntryPlayer } from './combat/structured-combat-payload';
import { MemoryManager } from './memory-manager';
import { fetchSceneState } from './narrative/scene-state-client';
import { SessionStateService } from './session-state-service';
import { dmResponseSchema } from '../../server-bun/src/services/dm/dm-response-schema';

import type { AIResponse, ChatMessage, GameContext } from './ai/shared/types';
import type { Memory } from './memory-manager';
import type { SessionVoiceContext } from './voice-consistency-service';
import type { PersistedRollOutcome } from '@/types/session-state';

import { llmApiClient } from '@/infrastructure/api';
import {
  PartyDefeatedError,
  QuotaExceededError,
  SessionExpiredError,
  ApiClientError,
  type TurnPhaseReporter,
} from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { hasStarterPlaythroughSignal } from '@/utils/starter-playthrough';

export type { AIResponse, ChatMessage, NarrationSegment, GameContext } from './ai/shared/types';

// In-flight request deduplication with 2s TTL
const inFlight = new Map<string, { ts: number; promise: Promise<AIResponse | unknown> }>();
const DEDUPE_MS = 2000;

// Helper for request deduplication key
function keyFor(sessionId: string | undefined, message: string, historyLen: number) {
  return `${sessionId || 'nosession'}|${message.slice(0, 256)}|${historyLen}`;
}

export { formatConversationHistoryMessage } from './ai/shared/conversation-history';

function reportTurnPhase(
  onTurnPhase: TurnPhaseReporter | undefined,
  phase: Parameters<TurnPhaseReporter>[0],
  requestId?: string | null,
): void {
  try {
    onTurnPhase?.(phase, requestId);
  } catch (loggingError) {
    logger.warn('[AIService] Turn-phase logging failed:', loggingError);
  }
}

/**
 * #2609: staleness bound for the roll-outcome gate. A repaired gate still needs
 * a rule for how old is too old: the outcome's roll_result entry must be newer
 * than the latest DM reply in the session, because the roll answers the DM's
 * current request. The reader skips typed mentions ("I rolled 17"), so without
 * this bound it can surface a stale authoritative outcome from an earlier turn —
 * that outcome must not reach the DM as `lastRollOutcome`.
 */
export function isRollOutcomeStale(
  outcome: PersistedRollOutcome,
  conversationHistory: ChatMessage[] | undefined,
): boolean {
  let latestDmReplyMs = -1;
  for (const message of conversationHistory ?? []) {
    if (message.speakerType !== 'dm') continue;
    const ts = message.timestamp;
    const ms = ts instanceof Date ? ts.getTime() : NaN;
    if (!Number.isNaN(ms) && ms > latestDmReplyMs) latestDmReplyMs = ms;
  }
  // No DM reply in history: the dice-UI flag gate stands alone; nothing to
  // prove stale.
  if (latestDmReplyMs < 0) return false;
  const outcomeMs = Date.parse(outcome.timestamp);
  // An unparseable outcome timestamp fails closed: never hand the DM an
  // outcome we cannot place after its request.
  if (Number.isNaN(outcomeMs)) return true;
  return outcomeMs <= latestDmReplyMs;
}

export class AIService {
  /**
   * Generate a campaign description using AI with fallback
   * Delegates to modular campaign-generator.ts which includes verbalized sampling
   */
  static async generateCampaignDescription(params: {
    genre: string;
    difficulty: string;
    length: string;
    tone: string;
  }): Promise<string> {
    // Delegate to modular campaign generator (includes verbalized sampling)
    return generateCampaignDescription(params);
  }

  /**
   * Generate a campaign name using AI
   * Delegates to modular campaign-generator.ts which includes verbalized sampling
   */
  static async generateCampaignName(params: {
    genre: string;
    difficulty: string;
    length: string;
    tone: string;
  }): Promise<string> {
    // Delegate to modular campaign generator (includes verbalized sampling)
    return generateCampaignName(params);
  }

  /** The request id of the latest DM generation, for log lines written after `chatWithDM`. */
  static lastRequestId(): string | null {
    return llmApiClient.lastGenerateRequestId ?? llmApiClient.lastRequestId;
  }

  /**
   * Simplified chat with AI DM for MVP with fallback
   * Uses a single AI call instead of complex agent system
   * Now includes voice segmentation for multi-voice narration
   */
  static async chatWithDM(params: {
    message: string;
    context: GameContext;
    conversationHistory?: ChatMessage[];
    userPlan?: 'free' | 'pro' | 'enterprise' | 'tester';
    turnCount?: number;
    relevantMemories?: Memory[];
    onProviderResponse?: (metadata: { provider?: 'openrouter' | 'gemini'; model?: string }) => void;
    onTurnPhase?: TurnPhaseReporter;
    /** Called after the envelope parses, before combat/roll handling or deferred writes. */
    onTextReady?: (response: AIResponse) => Promise<void> | void;
    /**
     * #2218: the id reserved for this turn's DM row, so the server can persist the reply, and
     * whether the engine may still resolve the turn (in which case the server must not).
     */
    dmReply?: {
      messageId: string;
      inCombat: boolean;
      narrationGated?: boolean;
      rollRequestId?: string;
    };
    /**
     * #2373: do not write memory, world updates or voice assignments for this reply. They are
     * returned on `heldSideEffects` for the caller to run once it has decided to keep the reply.
     */
    holdSideEffects?: boolean;
    /**
     * #2373: the reply just before this one was rejected, in the DM's own terms. Separate from
     * `message` so the player's words reach memory and the context builder unchanged.
     */
    narrationViolation?: string;
    /**
     * #2609: set by the dice-UI send path when the message carries a structured
     * roll result. Opens the roll-outcome gate — the retired ✓/✗ glyph regex
     * never fired on live formatter output (words, not glyphs, since #1866).
     * A typed "I rolled 17" never sets this.
     */
    isDiceRollMessage?: boolean;
    /** #2418: aborts the generate request, so a cancelled cast stops waiting for the DM. */
    signal?: AbortSignal;
    /**
     * #633 PR2: progressive narration chunks, in order, while the turn
     * streams. The resolved AIResponse is still built from the authoritative
     * final text.
     */
    onStream?: (chunk: string) => void;
  }): Promise<AIResponse> {
    // Dedupe in-flight chat calls (2s TTL)
    const key = keyFor(
      params.context?.sessionId,
      params.narrationViolation
        ? `${params.message}\n${params.narrationViolation}`
        : params.message,
      (params.conversationHistory || []).length,
    );
    const now = Date.now();
    for (const [k, v] of inFlight) if (now - v.ts > DEDUPE_MS) inFlight.delete(k);
    if (inFlight.has(key)) {
      logger.debug('[AIService] Deduping in-flight chat call:', key);
      return inFlight.get(key)!.promise as Promise<AIResponse>;
    }

    const p = (async () => {
      let preparationCheckpoint = performance.now();
      let rawResponse: string;
      let canonicalDmMessageId: string | undefined;
      let voiceContext: SessionVoiceContext | null = null;
      let isFirstMessage = false;
      try {
        // ⚡ Bolt: Use provided relevant memories if available, otherwise fetch them.
        // This allows for parallelization in the caller (e.g., use-ai-response.ts).
        let relevantMemories: Memory[] = params.relevantMemories || [];
        if (!params.relevantMemories && params.context.sessionId) {
          try {
            relevantMemories = await MemoryManager.getRelevantMemories(
              params.context.sessionId,
              params.message,
              8, // Get top 8 relevant memories
            );
            logger.info(`📚 Retrieved ${relevantMemories.length} relevant memories`);
          } catch (memoryError) {
            logger.warn('Failed to retrieve memories:', memoryError);
          }
        }

        logger.info('TURN_GENERATE_PREPARATION_TIMING', {
          sessionId: params.context.sessionId,
          stage: 'memory-fallback',
          ms: Math.round(performance.now() - preparationCheckpoint),
        });
        preparationCheckpoint = performance.now();

        // Get voice context for multi-voice narration
        // TEMPORARILY DISABLED for option button testing
        voiceContext = null;

        // Use OpenRouter API
        logger.info(`Using OpenRouter API for chat`);

        isFirstMessage =
          (!params.conversationHistory || params.conversationHistory.length === 0) &&
          (!params.message || params.message.trim() === '');

        // Build context prompt, and fetch server-owned narrative ground truth alongside it.
        //
        // `<scene_state>` is fetched HERE rather than inside ContextBuilder on purpose: per
        // memory-system-design-v2.md §3.3 the block belongs at the TRUE end of the prompt,
        // immediately before `<player_input>`, so it must stay a separate assembly piece.
        // The earlier approach (inject it into the context section, then regex-extract and
        // relocate it here) is exactly the hazard v2 §2.8 calls out — a regex relocation
        // over unescaped content — and main's post-#1687 ContextBuilder returns one opaque
        // string anyway. The fetch is awaited concurrently with the context build, so
        // ground truth costs no extra wall-clock on the turn path.
        // #2609: the gate opens from the roll itself, not from text. The dice-UI
        // send path passes `isDiceRollMessage`; the ✓/✗ regex is retired — no
        // live writer emits those glyphs since #1866.
        const shouldLoadRollOutcome = params.isDiceRollMessage === true;
        // #2450: the starter-campaign lore fetch is hoisted out of ContextBuilder
        // so the canon section can be relevance-ranked and token-capped BEFORE the
        // context prompt is built. Canon is budgeted to leave room for the
        // history floor: the canon block shrinks to fit, never the history.
        const starterCampaignId = resolveStarterCampaignId(params.context);
        // #352 nit: the steady-state path no longer runs buildGameContextSection's
        // legacy lore fetch, which was the only reporter of a missing starter
        // link. Report it here so the signal still fires on steady-state turns
        // (the opening turn still reports via the legacy path; the gate on
        // !isFirstMessage avoids double-reporting).
        if (!isFirstMessage) {
          const rawCampaignDetails = params.context.campaignDetails || {};
          const isStarterPlaythrough =
            params.context.isStarterPlaythrough ??
            (Boolean(starterCampaignId) || hasStarterPlaythroughSignal(rawCampaignDetails));
          if (isStarterPlaythrough && !starterCampaignId) {
            userDataApi.reportClientFailure(
              'missing_starter_campaign_id',
              params.context.sessionId,
              'Missing required starter_campaign_id for AI game context',
            );
          }
        }
        const [starterLoreData, sceneStateBlock, latestRollOutcome] = await Promise.all([
          (starterCampaignId
            ? CampaignContextPrompts.fetchStarterCampaignLore(starterCampaignId)
            : Promise.resolve(null)
          ).then((value) => {
            logger.info('TURN_GENERATE_PREPARATION_TIMING', {
              sessionId: params.context.sessionId,
              stage: 'starter-lore',
              ms: Math.round(performance.now() - preparationCheckpoint),
            });
            return value;
          }),
          params.context.sessionId
            ? fetchSceneState(params.context.sessionId).then((value) => {
                logger.info('TURN_GENERATE_PREPARATION_TIMING', {
                  sessionId: params.context.sessionId,
                  stage: 'scene-state',
                  ms: Math.round(performance.now() - preparationCheckpoint),
                });
                return value;
              })
            : Promise.resolve(null),
          shouldLoadRollOutcome && params.context.sessionId
            ? SessionStateService.getLatestRollOutcome(params.context.sessionId).then((value) => {
                logger.info('TURN_GENERATE_PREPARATION_TIMING', {
                  sessionId: params.context.sessionId,
                  stage: 'latest-roll-outcome',
                  ms: Math.round(performance.now() - preparationCheckpoint),
                });
                // #2609 staleness bound: the outcome answers the DM's current
                // request, so its roll_result entry must be newer than the
                // latest DM reply. Anything older is stale — omit the key.
                if (value && isRollOutcomeStale(value, params.conversationHistory)) {
                  logger.info('ROLL_OUTCOME_STALE_OMITTED', {
                    sessionId: params.context.sessionId,
                    outcomeTimestamp: value.timestamp,
                  });
                  return null;
                }
                return value;
              })
            : Promise.resolve(null),
        ]);

        logger.info('TURN_GENERATE_PREPARATION_TIMING', {
          sessionId: params.context.sessionId,
          stage: 'prompt-lore-scene-state-roll-outcome-parallel',
          ms: Math.round(performance.now() - preparationCheckpoint),
        });
        preparationCheckpoint = performance.now();

        // Rendered verbatim from the fact ledger; never assembled or interpreted client-side.
        // Empty when there is no ground truth to state, which leaves both prompts
        // byte-identical to their pre-ledger form.
        const sceneStateSection = sceneStateBlock ? `${sceneStateBlock}\n\n` : '';

        // Execute chat via llmApiClient
        // Build combined prompt from context, history, and message
        const stateEnvelope = JSON.stringify({
          ...(params.context.gameState || { isInCombat: false }),
          ...(latestRollOutcome ? { lastRollOutcome: latestRollOutcome } : {}),
        });
        const playerInput =
          params.message || 'Begin the adventure. Generate the opening scene for this campaign.';
        const resolutionOnly = params.context.gameState?.resolutionOnly === true;
        // #2341: the player named an attack, was asked, and chose not to strike.
        const combatEntryDeclined =
          typeof params.context.gameState?.combatEntryDeclined === 'string'
            ? params.context.gameState.combatEntryDeclined
            : null;
        const tacticalContext =
          typeof params.context.gameState?.tacticalContext === 'string'
            ? `\n<tactical_context>\n${params.context.gameState.tacticalContext}\n</tactical_context>`
            : '';
        // #352: the game state is authoritative and the security rules are
        // per-turn stable; the per-turn flags that used to be interpolated into
        // the rules text now travel in a short tail line inside the volatile
        // user message, so the cached system prefix never changes mid-scene.
        const gameStateBlock = `<immutable_game_state>${stateEnvelope}</immutable_game_state>`;
        const turnFlagsLine = buildTurnFlagsLine({
          resolutionOnly,
          combatEntryDeclined,
          narrationViolation: params.narrationViolation ?? null,
        });

        // #352: in/out of combat are the only two system-block variants; the
        // combat state flips only on combat start/end, so the system message
        // stays byte-identical across turns within a scene.
        const inCombat = params.context.gameState?.isInCombat === true;
        const { campaignName, campaignDescription, hasCampaignDetails } = extractCampaignDetails(params.context);
        // The opening turn keeps the legacy single-prompt assembly (no system
        // message): it has no scene yet and must see the whole campaign to
        // stage it. Every later turn splits stable -> volatile for caching.
        const systemPrompt = isFirstMessage
          ? undefined
          : buildSystemPrompt({
              campaignName,
              campaignDescription,
              hasCampaignDetails,
              inCombat,
              voiceContext,
            });

        // #2450: the session's current scene description, as its own short block.
        // Fixed prompt content (never canon-ranked away): the "where are we"
        // signal the DM needs when canon is capped and history is short.
        const currentSceneDescription = params.context.currentSceneDescription?.trim() || '';
        const sceneSection = currentSceneDescription
          ? `<current_scene>\n${currentSceneDescription}\n</current_scene>\n\n`
          : '';

        // Relevance signals for canon ranking: the last few turns as plain text,
        // plus the entities the ledger says are in the current scene (always kept).
        const recentTurnsText = (params.conversationHistory || [])
          .slice(-8)
          .map(formatConversationHistoryMessage)
          .join('\n\n');
        const activeEntityNames = CampaignContextPrompts.extractSceneEntityNames(sceneStateBlock);
        // #2533: after the opening, canon is rendered for this turn (the scene's entities plus
        // those the player's input, the last DM message and the scene name) instead of the whole
        // bible. The opening has no scene yet and must see the whole campaign to stage it.
        const lastDmMessage = [...(params.conversationHistory || [])]
          .reverse()
          .find(
            (message) =>
              (message.speakerType ?? (message.role === 'user' ? 'player' : 'dm')) === 'dm',
          );
        const turnScope = isFirstMessage
          ? undefined
          : {
              playerInput: params.message,
              lastDmMessage: lastDmMessage ? formatConversationHistoryMessage(lastDmMessage) : '',
              sceneText: [
                params.context.currentSceneDescription?.trim(),
                typeof params.context.gameState?.tacticalContext === 'string'
                  ? params.context.gameState.tacticalContext
                  : '',
              ]
                .filter(Boolean)
                .join('\n'),
              entityTokenBudget: DM_TURN_CANON_ENTITY_TOKEN_BUDGET,
            };

        // #352: stable -> volatile assembly. The opening turn keeps the legacy
        // single-prompt layout (everything in one user message); later turns
        // split the stable system message from the volatile user message.
        let fullPrompt: string;
        let loreSceneSection = '';
        let loreInputTail = '';
        let userGameContextSection = '';
        // The opening turn's ContextBuilder output, for the campaign_and_canon
        // metric (the steady-state turn measures the split user context).
        let openingContextPrompt = '';
        let canonCut = false;
        let historyBelowFloor = false;
        let historyContext = '';

        if (isFirstMessage) {
          // Legacy opening assembly: the opening has no scene yet and must
          // see the whole campaign to stage it.
          const assembleFixedPrompt = (contextPromptValue: string): string =>
            `${contextPromptValue}${sceneSection}${tacticalContext}\n\n${gameStateBlock}\n\n${sceneStateSection}<player_input>\n${playerInput}\n</player_input>`;

          // #2450: measure the fixed prompt WITHOUT canon, so the canon budget
          // leaves room for the history floor. Both builds are pure string
          // assembly; the lore fetch above happened once.
          const contextNoLore = await ContextBuilder.build({
            context: params.context,
            message: params.message,
            conversationHistory: params.conversationHistory,
            relevantMemories,
            voiceContext,
            isFirstMessage,
            loreSection: starterCampaignId ? '' : undefined,
          });
          const fixedNoLore = assembleFixedPrompt(contextNoLore);
          const canonBudget = Math.min(
            DM_CANON_TOKEN_CAP,
            Math.max(
              0,
              DM_PROMPT_TOKEN_BUDGET - DM_HISTORY_TOKEN_FLOOR - approximateTokens(fixedNoLore),
            ),
          );
          const loreResult = starterLoreData
            ? CampaignContextPrompts.renderStarterCampaignLore(starterLoreData, {
                tokenBudget: canonBudget,
                recentTurnsText,
                activeEntityNames,
                turnScope,
              })
            : null;

          const contextPrompt = await ContextBuilder.build({
            context: params.context,
            message: params.message,
            conversationHistory: params.conversationHistory,
            relevantMemories,
            voiceContext,
            isFirstMessage,
            loreSection: starterCampaignId ? (loreResult?.section ?? '') : undefined,
          }).then((value) => {
            logger.info('TURN_GENERATE_PREPARATION_TIMING', {
              sessionId: params.context.sessionId,
              stage: 'context-prompt',
              ms: Math.round(performance.now() - preparationCheckpoint),
            });
            return value;
          });
          openingContextPrompt = contextPrompt;

          const fixedPrompt = assembleFixedPrompt(contextPrompt);
          const historyBudget = Math.max(
            0,
            DM_PROMPT_TOKEN_BUDGET - approximateTokens(fixedPrompt),
          );
          historyBelowFloor = historyBudget < DM_HISTORY_TOKEN_FLOOR;
          historyContext = selectRecentMessagesWithinTokenBudget(
            (params.conversationHistory || []).slice(-DM_HISTORY_MAX_MESSAGES),
            formatConversationHistoryMessage,
            historyBudget,
          ).join('\n\n');
          // The opening carries the security base text inline (there is no
          // system message on the opening turn); per-turn flags ride their own
          // tail line exactly as on later turns.
          const openingSecurityBlock =
            `<security_rules>${SECURITY_RULES_BASE_TEXT}</security_rules>` +
            (turnFlagsLine ? `\n${turnFlagsLine}` : '');
          fullPrompt = `${contextPrompt}${sceneSection}${tacticalContext}\n\n${gameStateBlock}\n${openingSecurityBlock}\n\n${historyContext ? `<conversation_history>\n${historyContext}\n</conversation_history>\n\n` : ''}${sceneStateSection}<player_input>\n${playerInput}\n</player_input>`;
          loreSceneSection = loreResult?.section ?? '';
          canonCut = loreResult?.canonCut ?? false;
        } else {
          // #352: the steady-state turn. System message (stable) + user
          // message (scene-stable lore -> volatile tail).
          userGameContextSection = await GameContextPrompts.buildUserContextSection(
            params.context,
            relevantMemories,
          ).then((value) => {
            logger.info('TURN_GENERATE_PREPARATION_TIMING', {
              sessionId: params.context.sessionId,
              stage: 'context-prompt',
              ms: Math.round(performance.now() - preparationCheckpoint),
            });
            return value;
          });

          // Measure the fixed user message WITHOUT lore, so the canon budget
          // leaves room for the history floor.
          const fixedUserNoLore = assembleUserPrompt({
            loreScene: '',
            loreInputTail: '',
            userGameContext: userGameContextSection,
            currentScene: sceneSection,
            tacticalContext,
            historySection: '',
            gameState: gameStateBlock,
            turnFlagsLine,
            sceneState: sceneStateSection,
            playerInput,
          });
          // #352: reserve the history floor AND the tail budget before sizing
          // the scene lore, so scene lore + tail can never squeeze history
          // below the floor (the old single-render invariant was
          // lore <= canonBudget => history >= floor).
          const canonBudget = Math.min(
            DM_CANON_TOKEN_CAP,
            Math.max(
              0,
              DM_PROMPT_TOKEN_BUDGET -
                DM_HISTORY_TOKEN_FLOOR -
                DM_TURN_CANON_ENTITY_TOKEN_BUDGET -
                approximateTokens(`${systemPrompt ?? ''}${fixedUserNoLore}`),
            ),
          );

          // Scene-stable lore: refreshed only when the scene changes. The
          // ranking signal is the scene text itself (stable per scene), not
          // the sliding recent turns.
          const sceneKey = buildSceneKey({
            currentSceneDescription,
            activeEntityNames,
          });
          let sceneKeptNames: string[] = [];
          if (starterLoreData && starterCampaignId) {
            const cacheKey = {
              sessionId: params.context.sessionId,
              starterCampaignId,
              sceneKey,
            };
            const cached = sceneLoreCache.get(cacheKey);
            if (cached) {
              loreSceneSection = cached.section;
              sceneKeptNames = cached.keptEntityNames;
              canonCut = cached.canonCut;
            } else {
              const sceneRankingText = [currentSceneDescription, ...activeEntityNames].join('\n');
              const sceneResult = CampaignContextPrompts.renderStarterCampaignLore(
                starterLoreData,
                {
                  tokenBudget: canonBudget,
                  recentTurnsText: sceneRankingText,
                  activeEntityNames,
                  includeRoster: true,
                  // #352: the scene section carries the scene's entities plus
                  // the name roster — never the ranked fill. Input-matched
                  // extras ride the tail block.
                  sceneOnly: true,
                },
              );
              loreSceneSection = sceneResult.section;
              sceneKeptNames = sceneResult.keptEntityNames;
              canonCut = sceneResult.canonCut;
              sceneLoreCache.set(cacheKey, {
                section: loreSceneSection,
                keptEntityNames: sceneKeptNames,
                canonCut: sceneResult.canonCut,
              });
            }
          }

          // Per-turn input-matched extras the scene section does not carry,
          // as a small tail block. The scene's kept entities are excluded so
          // the tail never duplicates the scene section.
          if (starterLoreData && turnScope) {
            const tailResult = CampaignContextPrompts.renderStarterCampaignLore(starterLoreData, {
              tokenBudget: DM_TURN_CANON_ENTITY_TOKEN_BUDGET,
              recentTurnsText,
              activeEntityNames,
              turnScope,
              excludeEntityNames: sceneKeptNames,
              entitiesOnly: true,
            });
            if (tailResult.canonCut) canonCut = true;
            if (tailResult.keptEntities > 0) {
              loreInputTail = `<input_matched_lore>\n${tailResult.section}\n</input_matched_lore>`;
            }
          }

          const fixedPrompt = `${systemPrompt ?? ''}${assembleUserPrompt({
            loreScene: loreSceneSection,
            loreInputTail,
            userGameContext: userGameContextSection,
            currentScene: sceneSection,
            tacticalContext,
            historySection: '',
            gameState: gameStateBlock,
            turnFlagsLine,
            sceneState: sceneStateSection,
            playerInput,
          })}`;
          const historyBudget = Math.max(
            0,
            DM_PROMPT_TOKEN_BUDGET - approximateTokens(fixedPrompt),
          );
          historyBelowFloor = historyBudget < DM_HISTORY_TOKEN_FLOOR;
          historyContext = selectRecentMessagesWithinTokenBudget(
            (params.conversationHistory || []).slice(-DM_HISTORY_MAX_MESSAGES),
            formatConversationHistoryMessage,
            historyBudget,
          ).join('\n\n');
          fullPrompt = assembleUserPrompt({
            loreScene: loreSceneSection,
            loreInputTail,
            userGameContext: userGameContextSection,
            currentScene: sceneSection,
            tacticalContext,
            historySection: historyContext
              ? `<conversation_history>\n${historyContext}\n</conversation_history>`
              : '',
            gameState: gameStateBlock,
            turnFlagsLine,
            sceneState: sceneStateSection,
            playerInput,
          });
        }

        // Phase 0.6 (#1688): per-section prompt token telemetry, log-only. Computation is
        // wrapped so a failure here can never block sending the turn -- it just degrades to
        // an absent `metrics` field, which the server treats as backward compatible.
        //
        // Section split for THIS assembly (#352: stable -> volatile).
        //   - system: the `system` message (persona + campaign + rules + response
        //     structure + final reminders + security base text). Byte-identical
        //     across same-scene turns; the provider caches on this prefix.
        //   - lore_scene: the scene-stable lore section (cached per scene).
        //   - lore_tail: the per-turn input-matched lore extras.
        //   - campaign_and_canon: the character sheet + memories (`<game_context>`
        //     without campaign details or lore).
        //   - scene: the `<current_scene>` block (#2450) -- the session's current scene
        //     description, fixed prompt content that is never canon-ranked away.
        //   - tactical: the `<tactical_context>` block — board digest, turn order, combatant
        //     status. It USED to be summed into `scene_state` alongside the ledger block, and
        //     that fold is the whole reason a 2026-08-10 investigation concluded the digest
        //     "never reached the model": no `tactical` key had ever appeared in a log line, so
        //     its absence read as the block's absence, when in fact a ~450-token digest was
        //     being counted under someone else's name. Two independently-sourced blocks are two
        //     sections. A block nobody can measure is a block nobody can prove is there.
        //   - scene_state: the ledger-rendered `<scene_state>` block alone.
        //   - history: `historyContext`
        //   - player_input: `playerInput`
        //   - game_state: the `<immutable_game_state>` envelope
        //   - turn_flags: the `<turn_flags>` line ('' on ordinary turns)
        // `total` is the sum of the sections above (measurePromptSections' own total), not a
        // second token-count pass over the prompts -- the sections already cover essentially
        // all prompt content, so re-scanning the concatenated strings would be redundant.
        // `canon_cut` / `history_below_floor` (#2450) are 0/1 guard flags attached AFTER
        // measuring, so they never pollute `total`.
        let promptMetrics: Record<string, number> | undefined;
        try {
          promptMetrics = measurePromptSections({
            system: systemPrompt ?? '',
            lore_scene: loreSceneSection,
            lore_tail: loreInputTail,
            campaign_and_canon: isFirstMessage ? openingContextPrompt : userGameContextSection,
            scene: sceneSection,
            tactical: tacticalContext,
            scene_state: sceneStateBlock ?? '',
            game_state: gameStateBlock,
            turn_flags: turnFlagsLine,
            history: historyContext,
            player_input: playerInput,
          });
          promptMetrics.canon_cut = canonCut ? 1 : 0;
          promptMetrics.history_below_floor = historyBelowFloor ? 1 : 0;
        } catch (metricsError) {
          logger.warn('[AIService] Failed to compute prompt metrics:', metricsError);
          promptMetrics = undefined;
        }

        // #2450: loud alarm when canon was cut to fit or history fell below its
        // floor. Counts only -- never prompt text or player text.
        if (
          promptMetrics &&
          (promptMetrics.canon_cut === 1 || promptMetrics.history_below_floor === 1)
        ) {
          logger.warn('[AIService] Prompt budget guard tripped', {
            sessionId: params.context.sessionId,
            sections: promptMetrics,
          });
        }

        // #1907 PR1: inactive sessions carry the player context needed for server-side combat
        // entry detection. Active encounters do not need detection and must not manufacture a
        // pending entry from their ordinary combat actions. A declined entry (#2341) must not
        // either: the server would detect the same attack and ask the player again.
        const entryPlayer = buildCombatEntryPlayer(params.context.characterDetails);
        const combatEntry =
          params.context.sessionId &&
          entryPlayer &&
          params.context.gameState?.isInCombat !== true &&
          !combatEntryDeclined
            ? { sessionId: params.context.sessionId, player: entryPlayer }
            : undefined;

        logger.info('TURN_GENERATE_PREPARATION_TIMING', {
          sessionId: params.context.sessionId,
          stage: 'prompt-assembly-and-metrics',
          ms: Math.round(performance.now() - preparationCheckpoint),
        });
        reportTurnPhase(params.onTurnPhase, 'generate start');
        rawResponse = await llmApiClient.generateText({
          prompt: fullPrompt,
          // #352: the stable system block travels as the `system` message so
          // the provider can cache on the prompt prefix. The opening turn has
          // no system message (legacy single-prompt assembly).
          systemPrompt,
          // #2050 C: always send the session, not only via combatEntry (which is
          // absent once combat is active -- the very turns being diagnosed).
          sessionId: params.context?.sessionId,
          player_input: params.message,
          temperature: 0.9,
          maxTokens: 8192,
          responseSchema: dmResponseSchema,
          onResponseMetadata: (metadata) => {
            canonicalDmMessageId = metadata.dmReplyMessageId;
            params.onProviderResponse?.(metadata);
          },
          metrics: promptMetrics,
          combatEntry,
          dmReply: params.dmReply,
          signal: params.signal,
          // #633 PR2: opt the DM turn into server-sent narration deltas.
          ...(params.onStream ? { onStream: params.onStream } : {}),
        });
        reportTurnPhase(
          params.onTurnPhase,
          'generate end',
          llmApiClient.lastGenerateRequestId ?? llmApiClient.lastRequestId,
        );

        // #2236: cheap narration post-check against the engine's narration contract.
        // No second model call unless the check fails: one regeneration with the violation
        // list, then a deterministic engine-grounded fallback only for a factual contradiction.
        rawResponse = await enforceNarrationContract(rawResponse, {
          tacticalContext:
            typeof params.context.gameState?.tacticalContext === 'string'
              ? params.context.gameState.tacticalContext
              : null,
          generateText: (prompt) =>
            llmApiClient.generateText({
              prompt,
              sessionId: params.context?.sessionId,
              temperature: 0.3,
              maxTokens: 2048,
              metrics: promptMetrics,
            }),
          // One line per violation, with its rule and matched text, so the rate is measurable.
          onViolation: (violation, stage) =>
            logger.warn('[AIService] Narration contract violation', {
              sessionId: params.context?.sessionId,
              stage,
              rule: violation.rule,
              matched: violation.matched,
            }),
          onRegenError: (error) =>
            logger.warn('[AIService] Narration regen failed', {
              sessionId: params.context?.sessionId,
              error: error instanceof Error ? error.message : String(error),
            }),
        });
      } catch (providerError) {
        logger.error('LLM API failed:', providerError);
        // The daily quota is the player's to read, with its reset time; wrapping it hides both.
        if (providerError instanceof QuotaExceededError) throw providerError;
        // #2456: the party was defeated. Return the handled terminal state so
        // the UI renders the death screen; this is not a provider failure.
        if (providerError instanceof PartyDefeatedError) {
          logger.info('[AIService] Party defeated — returning terminal state', {
            encounterId: providerError.encounterId,
          });
          return {
            text: '',
            terminalState: 'party_defeated' as const,
            terminalEncounterId: providerError.encounterId,
          };
        }
        // #2601: typed errors survive the chatWithDM boundary. The downstream
        // handler checks instanceof/status on the top-level error; wrapping
        // them would defeat session-expiry and retry handling.
        if (providerError instanceof SessionExpiredError) throw providerError;
        if (providerError instanceof ApiClientError) throw providerError;
        // #2601 (candidate 18): preserve abort identity. The rewrap strips
        // the AbortError name, defeating abort-rethrow guards downstream.
        if (providerError instanceof Error && providerError.name === 'AbortError') {
          throw providerError;
        }
        throw new Error('Failed to get DM response - AI service unavailable', {
          cause: providerError,
        });
      }

      try {
        const responseParams = {
          rawResponse,
          context: params.context,
          message: params.message,
          conversationHistory: params.conversationHistory || [],
          userPlan: params.userPlan,
          turnCount: params.turnCount,
          voiceContext,
          isFirstMessage,
          onTurnPhase: params.onTurnPhase,
          deferSideEffects: Boolean(params.onTextReady) || Boolean(params.holdSideEffects),
        };
        const processedResponse = await processDMResponse(responseParams);
        if (canonicalDmMessageId) processedResponse.dmMessageId = canonicalDmMessageId;

        // The UI owns the render boundary. Once it confirms that the parsed response is ready,
        // bookkeeping can start without making the player wait for memory/world/voice work.
        if (params.holdSideEffects) {
          if (params.onTextReady) await params.onTextReady(processedResponse);
          // Run for the kept reply only; a rejected one must leave nothing in memory (#2373).
          let started = false;
          const heldSideEffects = async (): Promise<void> => {
            if (started) return;
            started = true;
            try {
              if (params.onTextReady) {
                await runDeferredDMResponseWork(responseParams, processedResponse);
              } else {
                await processDMResponseSideEffects(responseParams, processedResponse);
              }
            } catch (error) {
              logger.error('[AIService] Held response work failed:', error);
            }
          };
          return { ...processedResponse, heldSideEffects };
        }
        if (params.onTextReady) {
          await params.onTextReady(processedResponse);
          void runDeferredDMResponseWork(responseParams, processedResponse).catch((error) => {
            // The worker already logs each branch; this catches an unexpected orchestration
            // failure so it never becomes an unhandled rejection in the browser.
            logger.error('[AIService] Deferred response work failed:', error);
          });
        }

        return processedResponse;
      } catch (processingError) {
        const error =
          processingError instanceof Error ? processingError : new Error(String(processingError));
        logger.error('DM_RESPONSE_PROCESSING_FAILED', {
          name: error.name,
          message: error.message,
          stackHead: error.stack?.split('\n').slice(0, 2).join('\n') ?? '',
          requestId: llmApiClient.lastRequestId,
        });
        throw processingError;
      }
    })(); // End of the async promise wrapper

    // Store promise in in-flight map and return it
    inFlight.set(key, { ts: now, promise: p });
    // A cancelled call must not answer a retry of the same message inside the dedupe window.
    if (params.signal) p.catch(() => inFlight.delete(key));
    return trackDmWait(p);
  }

  /**
   * Generate an opening message for a new campaign session
   * Uses chatWithDM with empty message/history to trigger first message flow
   */
  static async generateOpeningMessage(params: { context: GameContext }): Promise<AIResponse> {
    const response = await AIService.chatWithDM({
      message: '',
      context: params.context,
      conversationHistory: [],
    });

    if (typeof response === 'string') {
      return { text: response };
    }
    return response.text ? response : { ...response, text: 'Welcome to your adventure!' };
  }

  /**
   * Get API statistics (for debugging)
   * @deprecated API stats are no longer tracked after Gemini removal
   */
  static getApiStats(): { provider: string; status: string } {
    return {
      provider: 'openrouter',
      status: 'Using server-proxied OpenRouter API',
    };
  }
}
