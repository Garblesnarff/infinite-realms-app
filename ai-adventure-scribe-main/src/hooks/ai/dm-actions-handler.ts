/* eslint-disable @typescript-eslint/no-explicit-any */

import { detectCombatCheck } from '../../../shared/combat-check-intent';

import type { LocalNotice } from '@/hooks/ai/types';
import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';
import type { PlayerAttackRollSpec } from '@/services/combat/player-roll-bridge';
import type {
  AdvanceNpcTurnsResponse,
  JournalHandoutEntry,
  TacticalMapActionPayload,
} from '@/services/user-data-api';

import { confirmCombatEntry } from '@/hooks/ai/combat-entry-hold';
import { resolveDeclaredCombatActions } from '@/hooks/ai/combat-resolution-step';
import {
  COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED,
  NPC_FIRST_ADVANCE_FAILED_NOTICE,
  isAbortError,
  preflightErrorStatus,
  preflightNpcTurnsBeforePlayerDeclaration,
} from '@/hooks/ai/combat-turn-preflight';
import { SessionExpiredError } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { filterValidHandoutActions } from '@/services/ai/valid-handout-actions';
import { type PlayerInputOrigin } from '@/services/combat/combat-action-origin';
import {
  runDeclaredCombatCheck,
  skillCheckModifierFor,
} from '@/services/combat/combat-check-client';
import {
  engineRosterOf,
  formatNpcTurnOutcome,
  npcTurnOptions,
} from '@/services/combat/combat-outcome-transcript';
import {
  enforceCombatActionOnAttempt,
  looksLikeCombatActionAttempt,
} from '@/services/combat/combat-zero-action-guard';
import { declaredSheetSpell } from '@/services/combat/declared-player-spell';
import { initiativeCard, type EngineResultCard } from '@/services/combat/engine-result-card';
import { isPlayerActor } from '@/services/combat/player-attack-roll';
import {
  requestPlayerAttackRoll,
  requestPlayerInitiativeRoll,
  trackPlayerRollDismissal,
} from '@/services/combat/player-roll-bridge';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';
import { standingHostiles } from '@/services/combat/sheet-cast-save-hold';
import { buildCombatEntryPlayer } from '@/services/combat/structured-combat-payload';
import { userDataApi } from '@/services/user-data-api';
import { dropEngineOwnedRollRequests, loggableRollType } from '@/utils/roll-request/engine-channel';
import { slugify } from '@/utils/slug';

export interface HandleDmActionsParams {
  sessionId: string;
  result: any;
  /** Retained for callers; combat entry no longer builds a participant here (#1779). */
  characterRecord?: Record<string, unknown>;
  activeEncounter: any;
  isInCombat: boolean;
  refreshCombatState: (signal?: AbortSignal) => Promise<any>;
  aiContext: any;
  conversationHistory: any[];
  /** NPC turns drained before the player's declaration was sent to chatWithDM. */
  preflightNpcTurns?: AdvanceNpcTurnsResponse;
  /** Round captured before preflight advances the authoritative encounter. */
  combatRound?: number;
  userPlan?: string;
  turnCount?: number;
  /** What the player typed this turn, for the zero-action guard below. */
  playerMessage?: string;
  /** A submitted dice result is a continuation, not a fresh attempt; the guard stands down. */
  isDiceRollMessage?: boolean;
  /** How the player gave this turn's input; `null` when no player message started it (#2305). */
  playerInputOrigin?: PlayerInputOrigin | null;
  /** The player already chose Strike on this turn's pending entry, before the DM was called (#2341). */
  entryConfirmed?: boolean;
  /**
   * Shows an engine line the moment it exists. An entry turn asks the player for a die after the
   * seating and the NPCs' opening turns; without this their lines wait for the whole resolution
   * and HP changes on screen with nothing said (#2378).
   */
  onEngineNotice?: (notice: LocalNotice) => void;
  /**
   * The caller already put `preflightNpcTurns`' lines on screen (#2386), so the resolution pass
   * must not print them a second time.
   */
  npcLinesShown?: boolean;
  signal?: AbortSignal;
  onPlayerWaitChange?: (waiting: boolean) => void;
}

export interface HandleDmActionsResult {
  result: any;
  responseText: string;
  narrationSegments: any[] | undefined;
  deliveredHandouts: JournalHandoutEntry[] | undefined;
  isInCombat: boolean;
  activeEncounter: any;
  /** Backwards-compatible newline-delimited notice text. Prefer localNotices for ownership. */
  localNotice?: string;
  /** Per-notice persistence metadata for local/system messages. */
  localNotices?: LocalNotice[];
}

function findParticipantForActor(
  actorId: string | undefined,
  participants: any[] | undefined,
): any | undefined {
  if (!actorId) return undefined;
  return participants?.find(
    (participant) =>
      participant.id === actorId || slugify(participant.name || '') === slugify(actorId),
  );
}

function isPlayerTurn(encounter: any, player: any): boolean {
  if (!encounter || !player) return false;
  if (encounter.currentTurnParticipantId === player.id) return true;
  const current = findParticipantForActor(
    encounter.currentTurnParticipantId,
    encounter.participants,
  );
  return current?.id === player.id;
}

function responsePayload(response: Response): Promise<unknown> {
  return response.json().catch(() => ({ status: response.status }));
}

const COMBAT_ENTRY_FAILURE_NOTICE =
  'Combat entry could not be confirmed. No attack outcome was resolved.';
const COMBAT_ENTRY_NO_HOST_NOTICE = 'Combat entry could not be confirmed (no confirmation UI)';
const COMBAT_ENTRY_NO_PLAYER_NOTICE = 'Combat entry is waiting for a valid player character.';
const COMBAT_ENTRY_DECLARE_ACTION_NOTICE = 'Combat has begun. Declare your action.';

function asEntryAction(value: unknown): StructuredCombatAction | null {
  if (!value || typeof value !== 'object') return null;
  const firstAction = value as Record<string, any>;
  const embedded = firstAction.combat_action;
  if (embedded && typeof embedded === 'object' && Array.isArray(embedded.target_ids)) {
    return embedded as StructuredCombatAction;
  }
  const actorId = firstAction.actor;
  const targetId = firstAction.target;
  if (typeof actorId !== 'string' || typeof targetId !== 'string') return null;
  const isSpell = firstAction.type === 'spell';
  return {
    actor_id: actorId,
    action_type: isSpell ? 'cast_spell' : 'attack',
    target_ids: [targetId],
    weapon_id: typeof firstAction.weaponId === 'string' ? firstAction.weaponId : null,
    spell_id: typeof firstAction.spellId === 'string' ? firstAction.spellId : null,
    slot_level: Number.isInteger(firstAction.slotLevel) ? firstAction.slotLevel : null,
    movement_feet: 0,
  };
}

function asEntryAttackRollSpec(value: unknown): PlayerAttackRollSpec | null {
  if (!value || typeof value !== 'object') return null;
  const firstAction = value as Record<string, any>;
  if (firstAction.type !== 'attack' || !firstAction.roll_request) return null;
  const roll = firstAction.roll_request as Record<string, any>;
  if (
    typeof roll.modifier !== 'number' ||
    typeof roll.ac !== 'number' ||
    typeof roll.advantage !== 'boolean' ||
    typeof roll.disadvantage !== 'boolean'
  ) {
    return null;
  }
  return {
    actorLabel: typeof roll.actorName === 'string' ? roll.actorName : firstAction.actorLabel,
    targetLabel: firstAction.targetLabel || firstAction.target,
    weaponName: firstAction.weaponName || firstAction.source || 'attack',
    attackBonus: roll.modifier,
    targetAc: roll.ac,
    advantage: roll.advantage,
    disadvantage: roll.disadvantage,
  };
}

function isCombatEntryConfirmationNoHostError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate.code === 'COMBAT_ENTRY_CONFIRMATION_HOST_UNAVAILABLE' ||
    candidate.name === 'CombatEntryConfirmationUnavailableError'
  );
}

/**
 * Puts the NPCs' turns on screen now, so the player's dice prompt cannot open while the tracker
 * shows HP that no line has explained (#2378, #2386). Persisted: the server did not save them.
 */
export function showNpcTurnLines(
  advanced: AdvanceNpcTurnsResponse,
  participants: any[] | undefined,
  onEngineNotice: (notice: LocalNotice) => void,
): void {
  const roster = engineRosterOf(participants);
  const show = (lines: string[], cards?: EngineResultCard[]): void => {
    const text = lines.join('\n\n').trim();
    if (text) onEngineNotice({ text, persist: true, ...(cards?.length ? { cards } : {}) });
  };
  for (const npcResult of advanced.results) {
    const { lines, cards } = formatNpcTurnOutcome(
      npcResult,
      roster,
      npcTurnOptions(participants, npcResult.action.target_ids?.[0]),
    );
    show(lines, cards);
  }
  if (advanced.capReached) {
    show(advanced.transcriptLines.filter((line) => line.includes('NPC turn loop stopped after')));
  }
}

export async function handleDmActionsAndTransitions(
  params: HandleDmActionsParams,
): Promise<HandleDmActionsResult> {
  const {
    sessionId,
    refreshCombatState,
    aiContext,
    conversationHistory,
    userPlan,
    turnCount,
    playerMessage,
    isDiceRollMessage,
    playerInputOrigin,
    preflightNpcTurns: initialPreflightNpcTurns,
    combatRound,
    signal,
  } = params;

  const awaitPlayerInput = async <T>(promise: Promise<T>): Promise<T> => {
    params.onPlayerWaitChange?.(true);
    try {
      if (!signal) return await promise;
      if (signal.aborted) {
        throw new DOMException('The request was aborted.', 'AbortError');
      }
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('The request was aborted.', 'AbortError')),
            { once: true },
          );
        }),
      ]);
    } finally {
      params.onPlayerWaitChange?.(false);
    }
  };

  let { result, activeEncounter, isInCombat } = params;
  let preflightNpcTurns = initialPreflightNpcTurns;
  let responseText = result.text;
  let narrationSegments = result.narrationSegments;
  let deliveredHandouts: JournalHandoutEntry[] | undefined;
  let localNotice: string | undefined;
  const localNotices: LocalNotice[] = [];
  let entryWasSeated = false;
  let entryFirstActionPresent = false;
  let entryFirstAction: StructuredCombatAction | null = null;
  let entryFirstActionPayload: unknown;
  // #2569: self-describing entry first_action status, computed when the `/enter`
  // payload is read. The declare-action notice paths log this, never the payload.
  let entryFirstActionStatus: 'accepted' | 'refused' | 'malformed' | 'absent' = 'absent';
  let entryPlayerAttackRoll:
    | { action: StructuredCombatAction; d20?: number; autoRolled: boolean; cancelled?: boolean }
    | undefined;
  let droppedNpcCombatActions = false;
  let npcLinesShown = params.npcLinesShown === true;

  const appendLocalNotice = (notice: unknown, persist = true, immediate = false): void => {
    if (typeof notice !== 'string' || !notice.trim()) return;
    const text = notice.trim();
    if (immediate && params.onEngineNotice) {
      params.onEngineNotice({ text, persist });
      return;
    }
    localNotice = localNotice ? `${localNotice}\n${text}` : text;
    localNotices.push({ text, persist });
  };

  /**
   * Every place this handler blanks the DM's roll list goes through here first, so a request
   * that never reaches the player is always logged by type (#2530). Type only, never content.
   */
  const logClearedRollRequests = (reason: string): void => {
    for (const request of (result.roll_requests ?? []) as Array<{ type?: string }>) {
      logger.warn('DM_ROLL_REQUEST_CLEARED', { reason, type: loggableRollType(request.type) });
    }
  };

  /** Puts the NPCs' opening turns on screen now, so they precede the player's dice prompt. */
  const showNpcTurns = (
    advanced: AdvanceNpcTurnsResponse,
    participants: any[] | undefined,
  ): void => {
    if (!params.onEngineNotice) return;
    showNpcTurnLines(advanced, participants, params.onEngineNotice);
    npcLinesShown = true;
  };

  // The server has detected combat but has not seated it. Confirm the player's intent before
  // asking for initiative: declining must not open a dice popup or roll a die.
  if (sessionId && !activeEncounter && result.combat_entry_pending) {
    const pendingEntry = result.combat_entry_pending;
    const player = buildCombatEntryPlayer(params.characterRecord);
    if (!player) {
      logger.warn('[CombatEntry] pending entry has no usable player payload; leaving it unseated');
      responseText = '';
      narrationSegments = undefined;
      appendLocalNotice(COMBAT_ENTRY_NO_PLAYER_NOTICE);
      logClearedRollRequests('entry_no_player');
      result = { ...result, combat_actions: [], roll_requests: [] };
    } else {
      try {
        // A held entry (#2341) was confirmed before the DM was called; asking again would open
        // the popup twice.
        const confirmed =
          params.entryConfirmed === true ||
          (await awaitPlayerInput(confirmCombatEntry(pendingEntry, player)));
        if (!confirmed) {
          // A decline is a real answer: do not call `/enter`, do not resolve the model's attack
          // batch, and do not let the pre-entry telegraph become a fabricated outcome.
          responseText = '';
          narrationSegments = undefined;
          appendLocalNotice(
            'Combat entry declined. No encounter was seated; your action was not resolved.',
          );
          logClearedRollRequests('entry_declined');
          result = {
            ...result,
            text: '',
            combat_transition: 'none',
            combat_entry_pending: undefined,
            combat_actions: [],
            map_actions: [],
            roll_requests: [],
          };
        } else {
          // The confirmation is the intent gate. Only after the player chooses Strike do we
          // request the initiative die that the explicit seating endpoint will consume.
          const initiative = await awaitPlayerInput(
            requestPlayerInitiativeRoll({
              actorLabel: player.name,
              initiativeModifier: player.initiativeModifier,
            }),
          );
          const enterPayload = {
            combatants: pendingEntry.combatants,
            sceneSpec: pendingEntry.sceneSpec,
            player,
            ...(pendingEntry.declaredAttack ? { declaredAttack: pendingEntry.declaredAttack } : {}),
            ...(pendingEntry.seatingHint ? { seatingHint: pendingEntry.seatingHint } : {}),
            ...(initiative.d20 === null ? {} : { playerInitiativeRoll: initiative.d20 }),
          };
          const enterResponse = signal
            ? await userDataApi.enterCombat(sessionId, enterPayload, signal)
            : await userDataApi.enterCombat(sessionId, enterPayload);
          if (!enterResponse.ok) {
            const failurePayload = await responsePayload(enterResponse);
            logger.warn('[CombatEntry] server refused explicit entry', failurePayload);
            if (enterResponse.status === 401) throw new SessionExpiredError();
            throw Object.assign(new Error(COMBAT_ENTRY_FAILURE_NOTICE), {
              name: 'CombatEntryFailedError',
              status: enterResponse.status,
            });
          } else {
            const entryPayload = await enterResponse.json().catch(() => null);
            // `seatCombatEntry` already persisted this exact system row. Keep it
            // visible locally, but do not send it through the client persistence
            // queue a second time.
            const seatingLine = (entryPayload as any)?.seatingTranscript;
            const seatingCard =
              typeof seatingLine === 'string' && params.onEngineNotice
                ? initiativeCard((entryPayload as any)?.participants ?? [], seatingLine.trim())
                : null;
            if (seatingCard && params.onEngineNotice) {
              params.onEngineNotice({
                text: seatingLine.trim(),
                persist: false,
                cards: [seatingCard],
              });
            } else {
              appendLocalNotice(seatingLine, false, true);
            }
            appendLocalNotice((entryPayload as any)?.notice);
            const enteredEncounterId =
              typeof (entryPayload as any)?.encounter?.id === 'string'
                ? (entryPayload as any).encounter.id
                : sessionId;
            entryWasSeated = true;
            entryFirstActionPresent = Object.prototype.hasOwnProperty.call(
              entryPayload ?? {},
              'first_action',
            );
            entryFirstActionPayload = (entryPayload as any)?.first_action;
            entryFirstAction = asEntryAction(entryFirstActionPayload);
            // #2569: compute the status here, where the payload is read, so every
            // downstream notice path can name the reason without re-deriving it.
            const refusalReason = (entryPayload as any)?.first_action_refusal?.reason;
            entryFirstActionStatus = entryFirstAction
              ? 'accepted'
              : typeof refusalReason === 'string'
                ? 'refused'
                : entryFirstActionPresent
                  ? 'malformed'
                  : 'absent';
            // #2569: the server-notice path logs its reason too. When the server refused
            // the declared action, this is the specific notice, not the generic one.
            if (typeof (entryPayload as any)?.notice === 'string') {
              logger.warn('COMBAT_ENTRY_SERVER_NOTICE', {
                reason: entryFirstActionStatus,
                path: 'server_notice',
                encounterId: enteredEncounterId,
              });
            }
            if (!entryFirstAction) {
              // One structured line saying why the entry first_action is unusable, so the
              // generic declare-action notice below is never the only evidence (#2551).
              // Reason only — never the payload.
              logger.warn('COMBAT_ENTRY_FIRST_ACTION_UNUSABLE', {
                reason:
                  typeof refusalReason === 'string'
                    ? refusalReason
                    : entryFirstActionPresent
                      ? 'malformed_first_action'
                      : 'absent_first_action',
                status: entryFirstActionStatus,
                encounterId: enteredEncounterId,
              });
            }
            responseText = '';
            narrationSegments = undefined;
            result = {
              ...result,
              // The model's pre-entry prose is a telegraph, not an outcome. Keep it out of the
              // post-entry result as well as the display channel until the engine has resolved the
              // declared action.
              text: '',
              combat_transition: 'none',
              // The explicit endpoint is the only authority that seats the encounter. This
              // marker lets the existing refresh branch below re-read the new board.
              combat_entry: {
                entered: true,
                encounterId: enteredEncounterId,
                trigger: pendingEntry.trigger,
                detail: pendingEntry.detail,
                sceneSpecSynthesized: pendingEntry.sceneSpecSynthesized,
              },
              // Combat roll requests belong to the engine resolution after seating, not to the
              // ordinary narrative dice queue. Checks are left for the in-combat drop below.
              roll_requests: (result.roll_requests || []).filter((request: any) => {
                const engineOwned = request.type === 'attack' || request.type === 'initiative';
                if (engineOwned) {
                  logger.warn('DM_ROLL_REQUEST_CLEARED', {
                    reason: 'entry_seated',
                    type: loggableRollType(request.type),
                  });
                }
                return !engineOwned;
              }),
              // The model batch is never consulted when `/enter` returned an engine-derived
              // first action. It is restored below only when first_action is absent.
              ...(entryFirstActionPresent ? { combat_actions: [] } : {}),
            };
          }
        }
      } catch (error) {
        logger.warn('[CombatEntry] explicit entry failed; no attack outcome was resolved', error);
        if (
          isAbortError(error) ||
          error instanceof SessionExpiredError ||
          (typeof error === 'object' &&
            error !== null &&
            (error as { status?: unknown }).status === 401)
        ) {
          throw error;
        }
        if (error instanceof Error && error.name === 'CombatEntryFailedError') throw error;
        if (!isCombatEntryConfirmationNoHostError(error)) throw error;
        responseText = '';
        narrationSegments = undefined;
        appendLocalNotice(
          isCombatEntryConfirmationNoHostError(error)
            ? COMBAT_ENTRY_NO_HOST_NOTICE
            : COMBAT_ENTRY_FAILURE_NOTICE,
        );
        logClearedRollRequests('entry_failed');
        result = { ...result, combat_actions: [], roll_requests: [] };
      }
    }
  }

  // #1779: combat entry is NOT decided here any more.
  //
  // This used to BE the entry gate — `combat_transition === 'start' && scene_spec` — one
  // unconstrained model-authored string, evaluated in the browser, with no engine-side
  // predicate behind it. Prod session 5ebaffab put four consecutive hostile actions through it
  // and never entered combat once. The decision now lives server-side in the turn pipeline
  // (`services/combat/combat-entry-gate.ts`), which now returns a pending handoff. PR2 owns the
  // popup and the explicit `/enter` call; this handler must not treat the pending handoff or the
  // model's raw `combat_transition: "start"` as a seated encounter.
  if (result.combat_entry?.entered) {
    logger.info('Server combat entry gate seated an encounter for this turn', {
      encounterId: result.combat_entry.encounterId,
      trigger: result.combat_entry.trigger,
      sceneSpecSynthesized: result.combat_entry.sceneSpecSynthesized,
    });
  }

  // #2524: the end transition is evaluated only AFTER declared actions resolve (below).
  // This block used to call `endTacticalMap` here — before `enforceCombatActionOnAttempt`
  // and `resolveDeclaredCombatActions` — and the refresh flipped `isInCombat` false, so
  // both were skipped and the player's declared attack was never rolled (run D1).

  // A seated entry (from the explicit endpoint) moves the board. A pending handoff and a
  // raw model start do not: no encounter exists until `/enter` succeeds.
  if (sessionId && result.combat_entry?.entered) {
    activeEncounter = await refreshCombatState(signal);
    if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
    isInCombat = activeEncounter?.phase === 'active';
    aiContext.gameState.isInCombat = isInCombat;
    aiContext.gameState.encounterId = activeEncounter?.id;
    aiContext.gameState.currentTurnPlayerId = activeEncounter?.currentTurnParticipantId;
    aiContext.gameState.round = activeEncounter?.currentRound;
  }

  // Entry is the one path that seats the board during this turn. It must use the same pre-flight
  // as an ordinary player declaration: drain every NPC now holding initiative before the queued
  // first_action reaches the combat engine.
  if (entryWasSeated && isInCombat && sessionId) {
    try {
      const preflight = await preflightNpcTurnsBeforePlayerDeclaration({
        sessionId,
        activeEncounter,
        characterId:
          typeof params.characterRecord?.id === 'string' ? params.characterRecord.id : '',
        refreshCombatState,
        signal,
      });
      activeEncounter = preflight.activeEncounter;
      isInCombat = preflight.isInCombat;
      preflightNpcTurns = preflight.npcTurns;
      if (preflightNpcTurns) showNpcTurns(preflightNpcTurns, activeEncounter?.participants);
      aiContext.gameState.isInCombat = isInCombat;
      aiContext.gameState.encounterId = activeEncounter?.id;
      aiContext.gameState.currentTurnPlayerId = activeEncounter?.currentTurnParticipantId;
      aiContext.gameState.round = activeEncounter?.currentRound;
    } catch (error) {
      if (isAbortError(error)) throw error;
      logger.warn(COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED, {
        sessionId,
        encounterId: activeEncounter?.id ?? null,
        status: preflightErrorStatus(error),
      });
      responseText = '';
      narrationSegments = undefined;
      logClearedRollRequests('entry_npc_advance_failed');
      result = {
        ...result,
        text: '',
        combat_actions: [],
        map_actions: [],
        handout_actions: [],
        roll_requests: [],
      };
      appendLocalNotice(NPC_FIRST_ADVANCE_FAILED_NOTICE);
      return {
        result,
        responseText,
        narrationSegments,
        deliveredHandouts,
        isInCombat,
        activeEncounter,
        localNotice,
        localNotices: localNotices.length > 0 ? localNotices : undefined,
      };
    }
  }

  const filterNpcCombatActions = (): void => {
    if (!isInCombat || !activeEncounter?.participants?.length || !result.combat_actions?.length) {
      return;
    }
    const playerActions = result.combat_actions.filter((action: any) =>
      isPlayerActor(action.actor_id, activeEncounter.participants),
    );
    const droppedActions = result.combat_actions.filter(
      (action: any) => !isPlayerActor(action.actor_id, activeEncounter.participants),
    );
    if (!droppedActions.length) return;
    droppedNpcCombatActions = true;
    for (const action of droppedActions) {
      logger.warn('DM_NPC_ACTION_DROPPED', {
        encounterId: activeEncounter.id,
        actorId: action.actor_id,
        actionType: action.action_type,
        targetIds: action.target_ids,
      });
    }
    result = { ...result, combat_actions: playerActions };
  };

  // Filter model-authored NPC actions before the zero-action repair and engine boundary. The
  // engine runner is the only NPC driver now; a stray model action is telemetry, never input.
  filterNpcCombatActions();

  // Once an encounter is open the engine owns every die: `processRollRequests` drops any DM
  // roll_request after this handler returns (#1807, #2378), so none of them ever reaches the
  // dice popup. The two guards below read the list to decide whether the turn is paused on that
  // popup, so an in-combat request has to go first. Left in, a typed attack answered with a
  // roll_request and no combat_action stood both guards down and then lost the request: nothing
  // resolved, nothing was shown, and the turn ended on prose alone (#2530).
  if (isInCombat && activeEncounter && result.roll_requests?.length) {
    // Attack and initiative requests are the DM's declaration channel and are dropped every
    // combat turn; a skill check or save is a die the player would expect to throw, so say so.
    const droppedRolls = new Set<string>();
    for (const request of result.roll_requests as Array<{ type?: string }>) {
      if (request.type === 'save') droppedRolls.add('saving throw');
      else if (request.type === 'check' || request.type === 'skill_check') {
        droppedRolls.add('skill check');
      }
    }
    for (const label of droppedRolls) {
      appendLocalNotice(
        `The DM asked for a ${label} roll, but dice in combat belong to the engine, so no roll was made.`,
      );
    }
    result = {
      ...result,
      roll_requests: dropEngineOwnedRollRequests(result.roll_requests, activeEncounter.id),
    };
  }

  // `/enter` is the source of truth for the player's declaration. Ask for the die from its
  // engine-generated modifier, then send the same structured action through the normal resolver.
  // If the endpoint returned no first action, retain the model batch as the documented fallback.
  if (entryWasSeated && entryFirstActionPresent) {
    if (entryFirstAction) {
      result = { ...result, combat_actions: [entryFirstAction] };
      const playerParticipant = activeEncounter?.participants?.find(
        (participant: any) =>
          participant.participantType === 'player' &&
          (!params.characterRecord?.id || participant.characterId === params.characterRecord.id),
      );
      if (
        activeEncounter &&
        playerParticipant &&
        isInCombat &&
        preflightNpcTurns?.combatEnded !== true &&
        isPlayerTurn(activeEncounter, playerParticipant)
      ) {
        if (
          entryFirstAction.action_type === 'attack' &&
          ((entryFirstActionPayload as any)?.reach === undefined ||
            (entryFirstActionPayload as any)?.reach?.inReach === true)
        ) {
          // The server always supplies this for an attack; malformed payloads use engine rolling.
          const actualRollSpec = asEntryAttackRollSpec(entryFirstActionPayload);
          if (actualRollSpec) {
            const roll = await awaitPlayerInput(requestPlayerAttackRoll(actualRollSpec));
            entryPlayerAttackRoll = roll.cancelled
              ? { action: entryFirstAction, autoRolled: false, cancelled: true }
              : {
                  action: entryFirstAction,
                  ...(roll.d20 === null ? {} : { d20: roll.d20 }),
                  autoRolled: roll.d20 === null,
                };
          } else {
            entryPlayerAttackRoll = { action: entryFirstAction, autoRolled: true };
          }
        } else if (entryFirstAction.action_type === 'cast_spell') {
          const { value: spellRoll, dismissed } = await awaitPlayerInput(
            trackPlayerRollDismissal(() =>
              askPlayerForSpellCast({
                encounterId: activeEncounter?.id,
                action: entryFirstAction,
                actorLabel: playerParticipant.name,
                participants: activeEncounter.participants,
              }),
            ),
          );
          entryPlayerAttackRoll = dismissed
            ? { action: entryFirstAction, autoRolled: false, cancelled: true }
            : {
                action: entryFirstAction,
                ...(spellRoll.d20 === undefined ? {} : { d20: spellRoll.d20 }),
                autoRolled: spellRoll.autoRolled,
              };
        }
      }
      if (preflightNpcTurns?.combatEnded === true) {
        result = { ...result, combat_actions: [] };
      }
    } else {
      result = { ...result, combat_actions: [] };
      // #2569: the notice path logs its reason — the status computed at payload read.
      logger.warn('COMBAT_ENTRY_DECLARE_ACTION_NOTICE', {
        reason: entryFirstActionStatus,
        path: 'first_action_unusable',
        encounterId: activeEncounter?.id ?? null,
      });
      appendLocalNotice(COMBAT_ENTRY_DECLARE_ACTION_NOTICE);
      responseText = '';
      narrationSegments = undefined;
    }
  } else if (entryWasSeated && !result.combat_actions?.length) {
    result = { ...result, combat_actions: [] };
    // #2569: the notice path logs its reason — the status computed at payload read.
    logger.warn('COMBAT_ENTRY_DECLARE_ACTION_NOTICE', {
      reason: entryFirstActionStatus,
      path: 'seated_without_actions',
      encounterId: activeEncounter?.id ?? null,
    });
    appendLocalNotice(COMBAT_ENTRY_DECLARE_ACTION_NOTICE);
    responseText = '';
    narrationSegments = undefined;
  }

  // DM map intents are one authenticated server batch. The server owns
  // legality, the single corrective LLM retry, persistence, and broadcast.
  if (sessionId && result.map_actions?.length) {
    const mapActions = result.map_actions as TacticalMapActionPayload[];
    const actionResponse = signal
      ? await userDataApi.applyDmTacticalActions(sessionId, mapActions, signal)
      : await userDataApi.applyDmTacticalActions(sessionId, mapActions);
    if (!actionResponse.ok) {
      logger.warn('Server refused DM tactical action batch', await actionResponse.json());
    }
  }

  if (sessionId && result.handout_actions?.length) {
    const { actions: handoutActions, dropped } = filterValidHandoutActions(
      result.handout_actions as unknown[],
    );
    if (dropped > 0) {
      logger.warn('[DMHandouts] Dropped invalid handout actions before request', {
        dropped,
      });
    }
    if (handoutActions.length > 0) {
      const handoutResponse = signal
        ? await userDataApi.applyDmHandoutActions(sessionId, handoutActions, signal)
        : await userDataApi.applyDmHandoutActions(sessionId, handoutActions);
      if (handoutResponse.ok) {
        const payload = (await handoutResponse.json()) as { entries?: JournalHandoutEntry[] };
        deliveredHandouts = payload.entries;
      } else {
        logger.warn('Server refused DM handout batch', await handoutResponse.json());
      }
    }
  }

  // Area spells are cast inside `resolveDeclaredCombatActions`, in the same batch as every other
  // declared action, so their engine line, turn boundary, and refusal are reported like any
  // other. Proposing them here, on the side, is how a refused Burning Hands became a console
  // warning and the DM narrated a spell that never happened (#2304).
  const declaredPlayerSpell = isInCombat ? declaredSheetSpell(playerMessage) : null;

  // #2420: a mid-combat ability check ("shove the goblin", "grapple it", "hide behind the
  // pillar", "talk it down"). Resolved HERE, beside the sheet cast, because the check is the
  // engine's turn rather than the DM's: the player rolls their own d20 in the ordinary roll
  // dialog, the engine rolls the contest, and the result is an engine line the DM restates. Run
  // any later, after the DM has already narrated the attempt, the fiction precedes the rules.
  //
  // Gated on the player actually holding the turn, so a check cannot spend an action the player
  // does not have, and on the check being recognised at all — an ordinary message, or one whose
  // check the engine has no owner for, falls through to today's behaviour with a reason logged.
  let declaredCombatCheck: Awaited<ReturnType<typeof runDeclaredCombatCheck>> | null = null;
  /** Set once the engine resolved the check: the turn is then the engine's line, not the DM's prose. */
  /** Set when the engine refused the check: nothing was rolled and the action is still the player's. */
  let refusedCombatCheck = false;
  let resolvedCombatCheck: {
    actorId: string;
    engineLine: string;
    dmFact: string;
  } | null = null;
  if (isInCombat && activeEncounter && playerInputOrigin === 'typed' && playerMessage?.trim()) {
    const checkRoster = activeEncounter.participants ?? [];
    const playerParticipant = checkRoster.find(
      (participant: any) =>
        participant.participantType === 'player' &&
        (!params.characterRecord?.id || participant.characterId === params.characterRecord.id),
    );
    if (playerParticipant && isPlayerTurn(activeEncounter, playerParticipant)) {
      // The player is on the roster and is not a target: with the player counted, "grapple it"
      // sees two creatures and never resolves.
      const detection = detectCombatCheck(
        playerMessage,
        standingHostiles(checkRoster).map((participant: any) => ({ name: participant.name ?? '' })),
      );
      // Only a message that really declared a check opens the roll prompt. Asking first and
      // discovering afterwards that the sentence was ordinary conversation is a die the player
      // rolled for nothing.
      if (detection.intent) {
        declaredCombatCheck = await runDeclaredCombatCheck(playerMessage, {
          encounterId: activeEncounter.id,
          actorId: playerParticipant.id,
          actorLabel: playerParticipant.name ?? 'You',
          participants: checkRoster,
          checkModifier: skillCheckModifierFor(playerParticipant, detection.intent.kind),
          origin: 'typed',
        });
        activeEncounter = await refreshCombatState(signal);
        if (declaredCombatCheck.reason === 'refused' && declaredCombatCheck.message) {
          // The engine's reason is the whole answer. The attempt did not happen, so the DM's
          // first-pass prose for it is stale too, and the turn is narrated as one where nothing
          // resolved.
          appendLocalNotice(`⚙️ Engine: ${declaredCombatCheck.message}`);
          refusedCombatCheck = true;
          result = { ...result, combat_actions: [], text: '' };
          responseText = '';
          narrationSegments = undefined;
        }
        const resolved = declaredCombatCheck.result as
          | { engineLine?: string; dmEngineLine?: string; dmFact?: string }
          | undefined;
        if (resolved?.engineLine) {
          appendLocalNotice(`⚙️ Engine: ${resolved.engineLine}`);
          // The engine resolved this turn, so the DM's first-pass reply is stale: it was written
          // before the roll and can state a result the engine did not produce, and any action it
          // declared for the player would spend an action the check already used. Narration is
          // rebuilt from the engine line below.
          resolvedCombatCheck = {
            actorId: playerParticipant.id,
            // The DM's copy of the line: the player's own line above keeps a DC the DM must not repeat.
            engineLine: resolved.dmEngineLine ?? resolved.engineLine,
            dmFact: resolved.dmFact ?? '',
          };
          result = { ...result, combat_actions: [], text: '' };
          responseText = '';
          narrationSegments = undefined;
        }
      }
    }
  }

  // #1701 repairs the action the engine refused. This repairs the action that was never
  // declared: during an active fight the player plainly attacked, and the DM answered with
  // prose and `actions:0`, so nothing was refused because nothing was submitted. Same budget,
  // same shape, same log — one corrective regeneration, then the turn stands as narrated.
  //
  // Placed above the `combat_actions` pipeline rather than inside it so a repaired turn takes
  // the identical path a first-try turn takes, AoE proposals included.
  //
  // The guard stands down on a seated-entry turn (the design is "Declare your action", nothing
  // resolved) and on a sheet cast (the engine refuses an undeclared one itself, #2304). Both
  // carried `combat_transition: 'none'`, which used to stop the guard by accident (#2380).
  const forcedActions =
    entryWasSeated ||
    entryFirstActionPresent ||
    droppedNpcCombatActions ||
    declaredPlayerSpell ||
    resolvedCombatCheck ||
    refusedCombatCheck
      ? null
      : await enforceCombatActionOnAttempt({
          isInCombat,
          hasActiveEncounter: !!activeEncounter,
          result,
          playerMessage,
          isDiceRollMessage,
          aiContext,
          conversationHistory,
          userPlan,
          turnCount,
          signal,
        });
  if (forcedActions) {
    result = { ...result, combat_actions: forcedActions.combat_actions };
    // The regenerated narration is what the corrected turn was written against.
    if (forcedActions.text) responseText = forcedActions.text;
  }

  // A typed message that produced no combat action, no roll request and no transition: nothing
  // was declared or refused, so the engine has no line for it and the DM's first-pass prose is
  // the only account of the turn. It is narrated again against a statement that nothing
  // happened (#2342). A roll request, a dice result or a sheet cast is a turn in progress.
  const silentPlayerTurn =
    isInCombat &&
    !!activeEncounter &&
    !entryWasSeated &&
    !isDiceRollMessage &&
    playerInputOrigin === 'typed' &&
    !!playerMessage?.trim() &&
    // A typed attack the DM answered with only NPC actions, or the repair could not turn into a
    // player action, is an attack that did not resolve, not a non-action. Not this path.
    (refusedCombatCheck || !looksLikeCombatActionAttempt(playerMessage)) &&
    !declaredPlayerSpell &&
    !resolvedCombatCheck &&
    !result.combat_actions?.length &&
    !result.roll_requests?.length &&
    // `processDMResponse` writes 'none' on every reply, so "no transition" is 'none' or absent (#2373).
    (!result.combat_transition || result.combat_transition === 'none') &&
    !/```ROLL_REQUESTS_V1/.test(result.text ?? '');

  const hasPreflightEngineLines = Boolean(
    preflightNpcTurns?.results?.length || preflightNpcTurns?.transcriptLines?.length,
  );
  // #2524: capture the declared exits before resolution — the resolution narration is
  // a fresh envelope and may not repeat them, but the end call below still needs them.
  // #2563: the DM's end request is also captured here, before resolution. The narration
  // pass that rewrites the turn is not required to repeat `combat_transition`, so reading
  // the transition only after resolution could silently drop an end the DM asked for;
  // the end is evaluated below, against the post-action board.
  const endRequested = result.combat_transition === 'end';
  const declaredExits = (
    result as {
      combat_exits?: Array<{ participant_id: string; exit: 'fled' | 'surrendered' | 'withdrew' }>;
    }
  ).combat_exits;
  const preflightCombatEnded = preflightNpcTurns?.combatEnded === true;
  if (
    !preflightCombatEnded &&
    activeEncounter &&
    (isInCombat || hasPreflightEngineLines) &&
    (result.combat_actions?.length ||
      hasPreflightEngineLines ||
      declaredPlayerSpell ||
      resolvedCombatCheck ||
      silentPlayerTurn)
  ) {
    const narrationResult = await resolveDeclaredCombatActions({
      encounterId: activeEncounter.id,
      sessionId,
      combatActions: result.combat_actions || [],
      declarationText: entryWasSeated
        ? 'Combat entry was confirmed. Narrate only authoritative engine results; the player declaration itself is not an outcome.'
        : result.text,
      participants: activeEncounter.participants,
      aiContext,
      conversationHistory,
      userPlan,
      turnCount,
      preResolvedNpcTurns: preflightNpcTurns,
      npcLinesShown,
      queuedIntentActorIds: activeEncounter?.pendingIntent?.actorId
        ? [activeEncounter.pendingIntent.actorId]
        : [],
      playerAttackRoll: entryPlayerAttackRoll,
      combatRound: combatRound ?? activeEncounter.currentRound,
      playerInputOrigin,
      playerMessage,
      declaredPlayerSpell,
      ...(resolvedCombatCheck ? { resolvedPlayerCheck: resolvedCombatCheck } : {}),
      signal,
      onPlayerWaitChange: params.onPlayerWaitChange,
      ...(silentPlayerTurn ? { silentPlayerTurn: { playerMessage: playerMessage as string } } : {}),
    });
    result = narrationResult;
    responseText = narrationResult.text;
    narrationSegments = narrationResult.narrationSegments;
  }

  // #2524: declared actions have now resolved, so the end transition is evaluated last.
  // Only a 409 is a scene-end refusal — a hostile is still standing with no declared
  // exit — and only a refusal overrides the transition: combat stays active (so the
  // zero-action guard stays armed for the player's next declaration) and the player is
  // told why. Any other failure keeps the old warning behavior; a network or server
  // error is not evidence the fight continues (#2563).
  if (sessionId && (endRequested || result.combat_transition === 'end')) {
    const endResponse = await userDataApi.endTacticalMap(sessionId, signal, declaredExits);
    const refused = endResponse.status === 409;
    if (!refused) {
      if (!endResponse.ok)
        logger.warn('Tactical combat end request failed', { status: endResponse.status });
      activeEncounter = await refreshCombatState(signal);
      if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
      isInCombat = activeEncounter?.phase === 'active';
      aiContext.gameState.isInCombat = isInCombat;
      aiContext.gameState.encounterId = activeEncounter?.id;
      aiContext.gameState.currentTurnPlayerId = activeEncounter?.currentTurnParticipantId;
      aiContext.gameState.round = activeEncounter?.currentRound;
    } else {
      logger.warn('Server refused tactical combat end', await endResponse.json().catch(() => null));
      result = { ...result, combat_transition: 'none' };
      isInCombat = true;
      aiContext.gameState.isInCombat = true;
      appendLocalNotice('The fight is not over — your opponent is still standing.');
    }
  }

  return {
    result,
    responseText,
    narrationSegments,
    deliveredHandouts,
    isInCombat,
    activeEncounter,
    localNotice,
    localNotices: localNotices.length > 0 ? localNotices : undefined,
  };
}
