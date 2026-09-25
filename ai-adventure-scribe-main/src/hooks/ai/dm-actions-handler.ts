/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  DMAoESpellAction,
  DMHandoutAction,
} from '../../../server-bun/src/services/dm/dm-response-schema';
import type { LocalNotice } from '@/hooks/ai/types';
import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';
import type { PlayerAttackRollSpec } from '@/services/combat/player-roll-bridge';
import type {
  AdvanceNpcTurnsResponse,
  JournalHandoutEntry,
  TacticalMapActionPayload,
} from '@/services/user-data-api';

import { resolveDeclaredCombatActions } from '@/hooks/ai/combat-resolution-step';
import {
  COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED,
  NPC_FIRST_ADVANCE_FAILED_NOTICE,
  preflightErrorStatus,
  preflightNpcTurnsBeforePlayerDeclaration,
} from '@/hooks/ai/combat-turn-preflight';
import { SessionExpiredError } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { requestCombatEntryConfirmation } from '@/services/combat/combat-entry-confirmation-bridge';
import { enforceCombatActionOnAttempt } from '@/services/combat/combat-zero-action-guard';
import { isPlayerActor } from '@/services/combat/player-attack-roll';
import {
  requestPlayerAttackRoll,
  requestPlayerInitiativeRoll,
  trackPlayerRollDismissal,
} from '@/services/combat/player-roll-bridge';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';
import { buildCombatEntryPlayer } from '@/services/combat/structured-combat-payload';
import { userDataApi } from '@/services/user-data-api';
import { slugify } from '@/utils/slug';

export interface HandleDmActionsParams {
  sessionId: string;
  result: any;
  /** Retained for callers; combat entry no longer builds a participant here (#1779). */
  characterRecord?: Record<string, unknown>;
  activeEncounter: any;
  isInCombat: boolean;
  refreshCombatState: () => Promise<any>;
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
    preflightNpcTurns: initialPreflightNpcTurns,
    combatRound,
  } = params;

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
  let entryPlayerAttackRoll:
    | { action: StructuredCombatAction; d20?: number; autoRolled: boolean; cancelled?: boolean }
    | undefined;
  let droppedNpcCombatActions = false;

  const appendLocalNotice = (notice: unknown, persist = true): void => {
    if (typeof notice !== 'string' || !notice.trim()) return;
    const text = notice.trim();
    localNotice = localNotice ? `${localNotice}\n${text}` : text;
    localNotices.push({ text, persist });
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
      result = { ...result, combat_actions: [], roll_requests: [] };
    } else {
      try {
        const combatantLabels = pendingEntry.combatants.map((combatant: any) => combatant.name);
        const declaredTarget = pendingEntry.declaredAttack?.actorName?.trim();
        const declaredTargets = declaredTarget ? [declaredTarget] : [];
        const normalizeLabel = (value: string): string =>
          value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const otherCombatants = declaredTargets.length
          ? combatantLabels.filter((label: string) => {
              const normalizedLabel = normalizeLabel(label);
              return !declaredTargets.some((target) => {
                const normalizedTarget = normalizeLabel(target);
                const escapedTarget = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const numberedDuplicate = new RegExp(`^${escapedTarget}\\s*\\d+$`);
                return (
                  normalizedLabel === normalizedTarget || numberedDuplicate.test(normalizedLabel)
                );
              });
            })
          : [];
        const confirmed = await requestCombatEntryConfirmation({
          actorLabel: player.name,
          combatantLabels,
          ...(declaredTargets.length ? { declaredTargets, otherCombatants } : {}),
          initiativeRoll: null,
          initiativeModifier: player.initiativeModifier,
        });
        if (!confirmed) {
          // A decline is a real answer: do not call `/enter`, do not resolve the model's attack
          // batch, and do not let the pre-entry telegraph become a fabricated outcome.
          responseText = '';
          narrationSegments = undefined;
          appendLocalNotice(
            'Combat entry declined. No encounter was seated; your action was not resolved.',
          );
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
          const initiative = await requestPlayerInitiativeRoll({
            actorLabel: player.name,
            initiativeModifier: player.initiativeModifier,
          });
          const enterResponse = await userDataApi.enterCombat(sessionId, {
            combatants: pendingEntry.combatants,
            sceneSpec: pendingEntry.sceneSpec,
            player,
            ...(pendingEntry.declaredAttack ? { declaredAttack: pendingEntry.declaredAttack } : {}),
            ...(pendingEntry.seatingHint ? { seatingHint: pendingEntry.seatingHint } : {}),
            ...(initiative.d20 === null ? {} : { playerInitiativeRoll: initiative.d20 }),
          });
          if (!enterResponse.ok) {
            const failurePayload = await responsePayload(enterResponse);
            logger.warn('[CombatEntry] server refused explicit entry', failurePayload);
            if (enterResponse.status === 401) throw new SessionExpiredError();
            responseText = '';
            narrationSegments = undefined;
            appendLocalNotice(COMBAT_ENTRY_FAILURE_NOTICE);
            result = { ...result, combat_actions: [], roll_requests: [] };
          } else {
            const entryPayload = await enterResponse.json().catch(() => null);
            // `seatCombatEntry` already persisted this exact system row. Keep it
            // visible locally, but do not send it through the client persistence
            // queue a second time.
            appendLocalNotice((entryPayload as any)?.seatingTranscript, false);
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
              // ordinary narrative dice queue. Keep non-combat checks intact.
              roll_requests: (result.roll_requests || []).filter(
                (request: any) => request.type !== 'attack' && request.type !== 'initiative',
              ),
              // The model batch is never consulted when `/enter` returned an engine-derived
              // first action. It is restored below only when first_action is absent.
              ...(entryFirstActionPresent ? { combat_actions: [] } : {}),
            };
          }
        }
      } catch (error) {
        logger.warn('[CombatEntry] explicit entry failed; no attack outcome was resolved', error);
        if (
          error instanceof SessionExpiredError ||
          (typeof error === 'object' &&
            error !== null &&
            (error as { status?: unknown }).status === 401)
        ) {
          throw error;
        }
        responseText = '';
        narrationSegments = undefined;
        appendLocalNotice(
          isCombatEntryConfirmationNoHostError(error)
            ? COMBAT_ENTRY_NO_HOST_NOTICE
            : COMBAT_ENTRY_FAILURE_NOTICE,
        );
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

  if (sessionId && result.combat_transition === 'end') {
    const endResponse = await userDataApi.endTacticalMap(sessionId);
    if (!endResponse.ok) {
      logger.warn('Server refused tactical combat end', await endResponse.json());
    }
  }

  // A seated entry (from the explicit endpoint) or an end transition moves the board. A pending
  // handoff and a raw model start do not: no encounter exists until `/enter` succeeds.
  if (sessionId && (result.combat_entry?.entered || result.combat_transition === 'end')) {
    activeEncounter = await refreshCombatState();
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
      });
      activeEncounter = preflight.activeEncounter;
      isInCombat = preflight.isInCombat;
      preflightNpcTurns = preflight.npcTurns;
      aiContext.gameState.isInCombat = isInCombat;
      aiContext.gameState.encounterId = activeEncounter?.id;
      aiContext.gameState.currentTurnPlayerId = activeEncounter?.currentTurnParticipantId;
      aiContext.gameState.round = activeEncounter?.currentRound;
    } catch (error) {
      logger.warn(COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED, {
        sessionId,
        encounterId: activeEncounter?.id ?? null,
        status: preflightErrorStatus(error),
      });
      responseText = '';
      narrationSegments = undefined;
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
            const roll = await requestPlayerAttackRoll(actualRollSpec);
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
          const { value: spellRoll, dismissed } = await trackPlayerRollDismissal(() =>
            askPlayerForSpellCast({
              action: entryFirstAction,
              actorLabel: playerParticipant.name,
              participants: activeEncounter.participants,
            }),
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
      appendLocalNotice(COMBAT_ENTRY_DECLARE_ACTION_NOTICE);
      responseText = '';
      narrationSegments = undefined;
    }
  } else if (entryWasSeated && !result.combat_actions?.length) {
    result = { ...result, combat_actions: [] };
    appendLocalNotice(COMBAT_ENTRY_DECLARE_ACTION_NOTICE);
    responseText = '';
    narrationSegments = undefined;
  }

  // DM map intents are one authenticated server batch. The server owns
  // legality, the single corrective LLM retry, persistence, and broadcast.
  if (sessionId && result.map_actions?.length) {
    const actionResponse = await userDataApi.applyDmTacticalActions(
      sessionId,
      result.map_actions as TacticalMapActionPayload[],
    );
    if (!actionResponse.ok) {
      logger.warn('Server refused DM tactical action batch', await actionResponse.json());
    }
  }

  if (sessionId && result.handout_actions?.length) {
    const handoutResponse = await userDataApi.applyDmHandoutActions(
      sessionId,
      result.handout_actions as DMHandoutAction[],
    );
    if (handoutResponse.ok) {
      const payload = (await handoutResponse.json()) as { entries?: JournalHandoutEntry[] };
      deliveredHandouts = payload.entries;
    } else {
      logger.warn('Server refused DM handout batch', await handoutResponse.json());
    }
  }

  // #1701 repairs the action the engine refused. This repairs the action that was never
  // declared: during an active fight the player plainly attacked, and the DM answered with
  // prose and `actions:0`, so nothing was refused because nothing was submitted. Same budget,
  // same shape, same log — one corrective regeneration, then the turn stands as narrated.
  //
  // Placed above the `combat_actions` pipeline rather than inside it so a repaired turn takes
  // the identical path a first-try turn takes, AoE proposals included.
  const forcedActions =
    entryFirstActionPresent || droppedNpcCombatActions
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
        });
  if (forcedActions) {
    result = { ...result, combat_actions: forcedActions.combat_actions };
    // The regenerated narration is what the corrected turn was written against.
    if (forcedActions.text) responseText = forcedActions.text;
  }

  if (sessionId && result.combat_actions?.length) {
    const aoeActions = result.combat_actions.filter(
      (action: any): action is DMAoESpellAction =>
        action.action_type === 'cast_spell' && 'origin' in action,
    );
    for (const action of aoeActions) {
      const response = await userDataApi.resolveAoECast(sessionId, {
        phase: 'propose',
        actorId: action.actor_id,
        spellId: action.spell_id,
        origin: action.origin,
        direction: action.direction,
        slotLevel: action.slot_level,
      });
      if (!response.ok) {
        logger.warn('Server refused AoE spell proposal', await response.json());
      }
    }
  }

  const hasPreflightEngineLines = Boolean(
    preflightNpcTurns?.results?.length || preflightNpcTurns?.transcriptLines?.length,
  );
  const preflightCombatEnded = preflightNpcTurns?.combatEnded === true;
  if (
    !preflightCombatEnded &&
    activeEncounter &&
    (isInCombat || hasPreflightEngineLines) &&
    (result.combat_actions?.length || hasPreflightEngineLines)
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
      queuedIntentActorIds: activeEncounter?.pendingIntent?.actorId
        ? [activeEncounter.pendingIntent.actorId]
        : [],
      playerAttackRoll: entryPlayerAttackRoll,
      combatRound: combatRound ?? activeEncounter.currentRound,
    });
    result = narrationResult;
    responseText = narrationResult.text;
    narrationSegments = narrationResult.narrationSegments;
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
