/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  combatRefusalReason,
  redactedCombatIntent,
  repairedTurnNotice,
  turnNotice,
} from './combat-notice';

import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';
import type { AdvanceNpcTurnsResponse } from '@/services/user-data-api';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import {
  CombatIntentRefusedError,
  combatBoundaryFromResult,
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import {
  formatCombatEngineOutcome,
  formatRefusedSpellOutcome,
  prependCombatEngineTranscript,
} from '@/services/combat/combat-outcome-transcript';
import { repairRefusedCombatAction } from '@/services/combat/combat-repair';
import { askPlayerForAttackDie, isPlayerActor } from '@/services/combat/player-attack-roll';
import { playerCombatSpellLabel } from '@/services/combat/player-combat-spell';
import { trackPlayerRollDismissal } from '@/services/combat/player-roll-bridge';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';
import { userDataApi } from '@/services/user-data-api';
import {
  combatRoundFrom,
  combatSequenceFrom,
  orderCombatEngineBlocks,
  type CombatEngineBlock,
} from '@/utils/combat-engine-blocks';
import { slugify } from '@/utils/slug';

/**
 * Handing the DM's declared combat actions to the engine, and narrating what the engine did.
 *
 * Lifted verbatim out of `dm-actions-handler` when the zero-action guard pushed that file past
 * its line budget. It reads better as its own step regardless — the handler above it dispatches
 * side effects, while this is the one place where the engine is authoritative and the DM is
 * merely reporting.
 *
 * "The engine is authoritative and the DM is merely reporting" is the whole contract, and #1744
 * is what it looks like when half of it is missing. The DM was told what the engine RESOLVED and
 * never told what it REFUSED, so a refused action left no trace in the narration pass at all —
 * and the DM, reading back its own declaration as established fact, narrated the outcome of an
 * attack that was never rolled. A report of what happened has to include the things that did
 * not.
 */

export interface CombatResolutionParams {
  encounterId: string;
  /** The session route is the stable client entry point for the autonomous turn loop. */
  sessionId?: string;
  combatActions: unknown[];
  /** The declaration the resolution narration is written against. */
  declarationText: string;
  aiContext: any;
  conversationHistory: any[];
  userPlan?: string;
  turnCount?: number;
  /** The encounter's participants, so the player's own attacks can be told apart. */
  participants?: Array<{
    id: string;
    name?: string;
    participantType?: string;
    turnOrder?: number;
    initiative?: number;
  }>;
  /** Actors whose refused declarations are already queued for their next legal turn. */
  queuedIntentActorIds?: string[];
  /** The entry endpoint already proposed this first action, and its die was requested upstream. */
  playerAttackRoll?: {
    action: StructuredCombatAction;
    d20?: number;
    autoRolled: boolean;
    /** The player dismissed this action's roll prompt; it must not resolve (#2234). */
    cancelled?: boolean;
  };
  /** NPC actions resolved before the player's declaration reached chatWithDM. */
  preResolvedNpcTurns?: AdvanceNpcTurnsResponse;
  /** Encounter round at the start of this resolution, used for older server payloads. */
  combatRound?: number;
}

const sameAction = (left: StructuredCombatAction, right: StructuredCombatAction): boolean =>
  left.actor_id === right.actor_id &&
  left.action_type === right.action_type &&
  left.weapon_id === right.weapon_id &&
  left.spell_id === right.spell_id &&
  left.slot_level === right.slot_level &&
  left.target_ids.length === right.target_ids.length &&
  left.target_ids.every((target, index) => target === right.target_ids[index]);

/**
 * Resolves targeted actions until the first turn or combat boundary, then asks the DM to narrate
 * the outcomes the engine produced — and only those. Refused actions travel into the narration
 * pass named as refusals, and when the player's own declaration was among them the turn holder is
 * stated by this layer rather than left to the model. A refusal that leaves the turn with nothing
 * at all to report is rethrown.
 */
export async function resolveDeclaredCombatActions(params: CombatResolutionParams): Promise<any> {
  const {
    encounterId,
    sessionId,
    combatActions,
    declarationText,
    aiContext,
    conversationHistory,
    userPlan,
    turnCount,
    participants,
    queuedIntentActorIds,
    playerAttackRoll,
    preResolvedNpcTurns,
    combatRound,
  } = params;

  const resolvedActions: Array<Record<string, unknown>> = [];
  const engineBlocks: CombatEngineBlock[] = [];
  /**
   * The actions the engine refused. They produced no roll, no damage, and no state change, so
   * they carry no outcome — and a narration pass that is never told about them writes one
   * anyway. On 2026-08-12 the player punched, the engine refused the action as out of turn, and
   * the DM opened with "Your strike with the greataxe leaves a deep gash in Balthazar's form…
   * He is clearly bloodied": a hit, a wound, a condition tier, and a weapon, none of which
   * existed. Recorded here so the resolution pass is told what did NOT happen.
   */
  const refusedActions: Array<Record<string, unknown>> = [];
  /** Whose turn it is once everything the engine accepted has been applied. */
  let turnHolder: { id?: string; name?: string } | null = null;
  let encounterAlreadyConcluded = false;
  let playerDeclarationWasRefused = false;
  /**
   * The player's declaration was refused and the repair replaced it with the turn holder's own
   * action. The refusal leaves the narration payload (the repaired turn is what happened), but
   * the player still has to be told whose turn it is when it is not theirs (#1744).
   */
  let playerRefusalRepaired = false;
  const targetedActions = combatActions.filter(
    (action: any): action is StructuredCombatAction => 'target_ids' in action,
  );
  // One repair attempt per turn, not per action: the budget belongs to the turn, and a DM
  // that got the actor wrong once will get it wrong for every action in the same batch.
  let repairSpent = false;
  let npcTurnRecoverySpent = false;
  type PlayerAttackRoll =
    | (Omit<Awaited<ReturnType<typeof askPlayerForAttackDie>>, 'movementOnly'> & {
        cancelled?: boolean;
      })
    | null;
  /** The player's own action whose roll prompt they dismissed. Nothing after it resolves. */
  let cancelledPlayerAction: StructuredCombatAction | null = null;
  const playerDieByAction = new WeakMap<StructuredCombatAction, PlayerAttackRoll>();
  const queuedActorIds = new Set(queuedIntentActorIds ?? []);
  const queuedActorSlugs = new Set(
    participants
      ?.filter((participant) => queuedActorIds.has(participant.id))
      .map((participant) => slugify(participant.name ?? ''))
      .filter(Boolean),
  );
  const isQueuedIntentActor = (actorId: string): boolean =>
    queuedActorIds.has(actorId) || queuedActorSlugs.has(slugify(actorId));
  const labelFor = (actorId: string): string =>
    participants?.find((participant) => participant.id === actorId)?.name ?? actorId;
  const appendEngineBlock = ({
    source,
    actorId,
    lines,
    round,
    serverSequence,
  }: {
    source: CombatEngineBlock['source'];
    actorId?: string;
    lines: string[];
    round: number;
    serverSequence?: number;
  }): void => {
    const cleanLines = lines.filter((line): line is string => typeof line === 'string' && !!line);
    if (!cleanLines.length) return;
    engineBlocks.push({
      sequence: engineBlocks.length,
      ...(serverSequence === undefined ? {} : { serverSequence }),
      round,
      source,
      ...(actorId ? { actor: labelFor(actorId) } : {}),
      lines: cleanLines,
    });
  };
  const recordRefusal = (action: StructuredCombatAction, refusal: CombatIntentRefusedError) => {
    const queued = isQueuedIntentActor(action.actor_id);
    const actorIsPlayer = isPlayerActor(action.actor_id, participants);
    const reason = combatRefusalReason(refusal);
    if (actorIsPlayer) playerDeclarationWasRefused = true;
    refusedActions.push({
      resolved: false,
      ...(queued ? { queued: true } : {}),
      actor: labelFor(action.actor_id),
      actorIsPlayer,
      action: action.action_type,
      targets: action.target_ids?.map(labelFor) ?? [],
      engineRefusal: refusal.message,
      refusalReason: reason,
      // The engine names the turn holder on every out-of-turn refusal (#1700). It is the one
      // thing the player actually needs to be told, and it was being discarded.
      currentTurn: refusal.details?.currentParticipantId
        ? labelFor(refusal.details.currentParticipantId)
        : (refusal.details?.currentParticipantSlug ?? null),
    });
    logger.warn('[CombatRepair] rejected intent', {
      reason,
      intent: redactedCombatIntent(action),
    });
    if (action.action_type === 'cast_spell') {
      const spell = playerCombatSpellLabel(action.spell_id, action.spell_id);
      appendEngineBlock({
        source: actorIsPlayer ? 'player' : 'npc',
        actorId: action.actor_id,
        lines: [formatRefusedSpellOutcome(labelFor(action.actor_id), spell, refusal.message)],
        round: combatRound ?? 1,
      });
      if (actorIsPlayer) {
        logger.warn('PLAYER_ACTION_UNRESOLVED', { actionType: 'cast_spell', spell });
      }
    }
  };
  type BatchBoundary = 'turn_ended' | 'combat_ended';

  const appendAutonomousNpcResults = (
    advanced: AdvanceNpcTurnsResponse,
    afterPlayerAction = false,
  ): BatchBoundary => {
    const defaultRound = combatRoundFrom(advanced, combatRound ?? 1);
    const playerOrder = participants?.find(
      (participant) => participant.participantType === 'player',
    )?.turnOrder;
    for (const npcResult of advanced.results) {
      const { transcriptLines, ...authoritativeResult } = npcResult;
      resolvedActions.push({
        ...authoritativeResult,
        actorIsPlayer: false,
      });
      const engineTranscript = formatCombatEngineOutcome(npcResult.action, npcResult.engineResult);
      const npcOrder = participants?.find(
        (participant) => participant.id === npcResult.action.actor_id,
      )?.turnOrder;
      // Legacy payloads carry no round, so it is inferred from turn order. This assumes at most
      // one round wrap per `advanceNpcTurns` batch: every NPC seated before the player is put
      // in the next round, and nothing is put two rounds ahead. A batch that crosses more than
      // one round boundary would be labelled short. Server round/sequence metadata (#2127
      // follow-up) replaces this inference wherever it is present.
      const wrapsRound =
        afterPlayerAction &&
        typeof playerOrder === 'number' &&
        typeof npcOrder === 'number' &&
        npcOrder < playerOrder;
      const inferredRound =
        afterPlayerAction &&
        (wrapsRound || typeof playerOrder !== 'number' || typeof npcOrder !== 'number')
          ? defaultRound + 1
          : defaultRound;
      appendEngineBlock({
        source: 'npc',
        actorId: npcResult.action.actor_id,
        lines: [...(engineTranscript ? [engineTranscript] : []), ...transcriptLines],
        round: combatRoundFrom(npcResult, inferredRound),
        serverSequence: combatSequenceFrom(npcResult),
      });
    }
    // Death-save lines are attached to their result above. The top-level stream carries the
    // safety-cap line, which has no individual action to attach to.
    if (advanced.capReached) {
      appendEngineBlock({
        source: 'npc',
        lines: advanced.transcriptLines.filter((line) =>
          line.includes('NPC turn loop stopped after'),
        ),
        round: defaultRound,
        serverSequence: combatSequenceFrom(advanced),
      });
    }
    if (advanced.currentParticipant) turnHolder = advanced.currentParticipant;
    return advanced.combatEnded ? 'combat_ended' : 'turn_ended';
  };

  // The pre-flight ran before the declaration was sent to the DM. Carry those already-authoritative
  // NPC results into this same narration pass so the reply contains one ordered account of the
  // NPC engine lines followed by the player's action.
  const preflightBoundary = preResolvedNpcTurns
    ? appendAutonomousNpcResults(preResolvedNpcTurns)
    : null;

  const runAction = async (action: StructuredCombatAction): Promise<BatchBoundary> => {
    // The player throws their own attack die; monsters keep rolling behind the screen. The
    // detour is scoped to attacks with a target, since that is the roll the popup can describe.
    let playerDie: PlayerAttackRoll;
    if (playerDieByAction.has(action)) {
      playerDie = playerDieByAction.get(action) ?? null;
    } else {
      const entryRoll =
        playerAttackRoll && sameAction(playerAttackRoll.action, action) ? playerAttackRoll : null;
      const actorLabel =
        participants?.find((participant) => participant.id === action.actor_id)?.name ??
        action.actor_id;
      const asksPlayer =
        !entryRoll &&
        !isQueuedIntentActor(action.actor_id) &&
        isPlayerActor(action.actor_id, participants) &&
        (action.action_type === 'attack' || action.action_type === 'cast_spell');
      if (entryRoll) {
        playerDie = entryRoll;
      } else if (asksPlayer) {
        const asked = await trackPlayerRollDismissal(() =>
          action.action_type === 'attack'
            ? askPlayerForAttackDie({ encounterId, action, actorLabel })
            : askPlayerForSpellCast({ action, actorLabel, participants }),
        );
        playerDie = asked.dismissed ? { autoRolled: false, cancelled: true } : asked.value;
      } else {
        playerDie = null;
      }
      playerDieByAction.set(action, playerDie);
    }
    // A dismissed prompt withdraws the action. It is not submitted, the turn is not ended, and
    // nothing else in this declaration runs: the player chose not to act yet (#2234).
    if (playerDie?.cancelled) {
      cancelledPlayerAction = action;
      logger.info('[PlayerRoll] player dismissed the roll prompt; action withdrawn', {
        actionType: action.action_type,
      });
      return 'turn_ended';
    }
    const execution = await executeStructuredCombatActionWithBoundary(
      encounterId,
      action,
      playerDie?.d20,
    );
    // A retry that arrived after victory is a clean server no-op, not an outcome to narrate.
    // The batch is over either way; do not submit the next action against the dissolved board.
    if (execution.boundary === 'encounter_already_concluded') {
      encounterAlreadyConcluded = true;
      return 'combat_ended';
    }
    const engineTranscript = formatCombatEngineOutcome(action, execution.result);
    appendEngineBlock({
      source: isPlayerActor(action.actor_id, participants) ? 'player' : 'npc',
      actorId: action.actor_id,
      lines: engineTranscript ? [engineTranscript] : [],
      round: combatRoundFrom(execution.result, combatRound ?? 1),
      serverSequence: combatSequenceFrom(execution.result),
    });
    resolvedActions.push({
      action,
      outcomes: execution.outcomes,
      ...(execution.result !== undefined ? { engineResult: execution.result } : {}),
      // Carried into the resolution prompt so a die the player did not throw is narrated as
      // such rather than passed off as theirs.
      ...(playerDie?.autoRolled ? { autoRolled: true } : {}),
    });
    if (execution.boundary === 'combat_ended') return 'combat_ended';
    // The engine ends an NPC's turn itself now (#1744), so this either performs the boundary or
    // is told the boundary already happened. Both answers name whoever is up, which is what the
    // player has to be told when their own declaration was refused.
    const turn = await executeAuthoritativeCombatIntent(
      encounterId,
      { type: 'end_turn', actorId: action.actor_id },
      'dm',
    );
    if (combatBoundaryFromResult(turn)) return 'combat_ended';
    const turnState = turn as { currentParticipant?: { id?: string; name?: string } | null } | null;
    if (turnState?.currentParticipant) turnHolder = turnState.currentParticipant;
    if (sessionId && isPlayerActor(action.actor_id, participants)) {
      const advanced = await userDataApi.advanceNpcTurns(sessionId, turnHolder?.id);
      return appendAutonomousNpcResults(advanced, true);
    }
    return 'turn_ended';
  };

  for (
    let actionIndex = 0;
    preflightBoundary !== 'combat_ended' && actionIndex < targetedActions.length;
    actionIndex += 1
  ) {
    const action = targetedActions[actionIndex];
    try {
      const boundary = await runAction(action);
      const dropped = targetedActions.length - actionIndex - 1;
      if (dropped > 0) {
        logger.info(`[CombatBatch] boundary=${boundary} dropped=${dropped}`);
      }
      if (boundary) break;
    } catch (error) {
      if (!(error instanceof CombatIntentRefusedError)) throw error;
      recordRefusal(action, error);
      const refusedCurrentParticipantId = error.details?.currentParticipantId;
      if (
        sessionId &&
        !npcTurnRecoverySpent &&
        isPlayerActor(action.actor_id, participants) &&
        refusedCurrentParticipantId &&
        !isPlayerActor(refusedCurrentParticipantId, participants)
      ) {
        npcTurnRecoverySpent = true;
        const refusalIndex = refusedActions.length - 1;
        const advanced = await userDataApi.advanceNpcTurns(sessionId, refusedCurrentParticipantId);
        const recoveryBoundary = appendAutonomousNpcResults(advanced, true);
        if (recoveryBoundary === 'combat_ended') break;
        try {
          const retryBoundary = await runAction(action);
          // The first refusal was transient: the same player action was accepted after the
          // stale NPC turn was settled, so do not ask narration to report it as unresolved.
          refusedActions.splice(refusalIndex, 1);
          if (retryBoundary) break;
          continue;
        } catch (retryError) {
          if (!(retryError instanceof CombatIntentRefusedError)) throw retryError;
          recordRefusal(action, retryError);
          logger.warn('[CombatRepair] NPC-turn recovery retry was refused');
          continue;
        }
      }
      if (isQueuedIntentActor(action.actor_id)) {
        // A pending declaration is deliberately not re-declared as whoever owns the current
        // turn. PR2 will confirm it when this actor becomes current; it must not consume the
        // one-shot repair budget or become another participant's action (#1908).
        logger.info(`[CombatRepair] outcome=queued actor=${action.actor_id}`);
        continue;
      }
      if (repairSpent) {
        // A second refusal is not repaired again, and it is no longer thrown while the engine
        // has results to report either. Throwing here is what turned an NPC's refusal into
        // "I encountered an issue processing your message" on a turn where real actions had
        // already been resolved.
        logger.warn(`[CombatRepair] outcome=refused_again actor=${action.actor_id}`);
        continue;
      }
      repairSpent = true;
      const repairRefusalIndex = refusedActions.length - 1;
      const repaired = await repairRefusedCombatAction({
        refusal: error,
        refusedAction: action,
        aiContext,
        conversationHistory,
        userPlan,
        turnCount,
      });
      const corrected = repaired?.combat_actions?.filter(
        (candidate): candidate is StructuredCombatAction => 'target_ids' in candidate,
      );
      if (!corrected?.length) {
        logger.warn('[CombatRepair] outcome=failed no usable corrected action; surfacing');
        if (action.action_type === 'cast_spell' && engineBlocks.length) {
          // A refused spell already has an engine line. Do not swallow it behind a thrown error.
          break;
        }
        throw error;
      }
      // The corrected turn replaces the refused one. A second refusal is not repaired again.
      let correctedBoundary: BatchBoundary | null = null;
      let repairRefused = false;
      for (let correctedIndex = 0; correctedIndex < corrected.length; correctedIndex += 1) {
        const correctedAction = corrected[correctedIndex];
        try {
          correctedBoundary = await runAction(correctedAction);
        } catch (correctedError) {
          if (!(correctedError instanceof CombatIntentRefusedError)) throw correctedError;
          // The repair was refused too. Report it like any refusal instead of throwing: a throw
          // here dropped every engine line and showed "I encountered an issue processing your
          // message" (#2234). The original refusal stays in the report.
          recordRefusal(correctedAction, correctedError);
          logger.warn(`[CombatRepair] outcome=repair_refused actor=${correctedAction.actor_id}`);
          repairRefused = true;
          break;
        }
        const dropped = corrected.length - correctedIndex - 1;
        if (dropped > 0) {
          logger.info(`[CombatBatch] boundary=${correctedBoundary} dropped=${dropped}`);
        }
        if (correctedBoundary) break;
      }
      if (repairRefused) break;
      // The corrected action was accepted, so the original refusal is no longer an unresolved
      // player notice. Keep it only when the repair itself was refused.
      const [repairedRefusal] = refusedActions.splice(repairRefusalIndex, 1);
      if (repairedRefusal?.actorIsPlayer && correctedBoundary !== 'combat_ended') {
        playerRefusalRepaired = true;
      }
      logger.info('[CombatRepair] outcome=repaired');
      if (correctedBoundary) break;
      // The original assigned `responseText = repaired.text` here. It was dead: the resolution
      // narration below overwrites `responseText` unconditionally on every path out of this
      // function, so the repaired declaration never reached the player either way. Dropped in
      // the extraction rather than carried across as a line that cannot have an effect.
    }
  }

  if (cancelledPlayerAction) {
    // No DM narration: the declaration prose describes an action that did not happen, and the
    // narration pass would be handed it as setup. Engine lines already produced (NPC turns
    // resolved before the declaration) still stand and are shown.
    const orderedBlocks = orderCombatEngineBlocks(engineBlocks);
    return {
      text: prependCombatEngineTranscript(
        withdrawnActionNotice(cancelledPlayerAction),
        orderedBlocks.flatMap((block) => block.lines),
      ),
      combatEngineBlocks: orderedBlocks,
    };
  }

  const refusedPlayerActions = refusedActions.filter((refusal) => refusal.actorIsPlayer);
  /**
   * The declaration the narration is written against — withheld when it declared something the
   * engine then refused.
   *
   * This is the channel the fabricated greataxe came down. Everything else the resolution pass
   * sees is engine output, and a refused action produces none, so the ONLY place the DM could
   * have read a player attack that never happened is its own declaration prose, handed back to
   * it as established fact. A repaired turn's real actions are in `authoritativeCombatResults`
   * and need no prose to be narrated from.
   */
  const setupText = playerDeclarationWasRefused
    ? 'The declaration for this turn was refused by the engine and is void. Narrate only the ' +
      'authoritative results supplied, and state whose turn it is.'
    : encounterAlreadyConcluded
      ? 'Combat has already concluded. This batch is a no-op; do not narrate its declared action ' +
        'as something that happened.'
      : declarationText;

  const playerTurn = isPlayerActor(turnHolder?.id ?? '', participants);
  const playerName =
    participants?.find((participant) => participant.id === turnHolder?.id)?.name ??
    turnHolder?.name ??
    'Player';
  const orderedEngineBlocks = orderCombatEngineBlocks(engineBlocks);
  const orderedEngineTranscriptLines = orderedEngineBlocks.flatMap((block) => block.lines);
  const narration = await AIService.chatWithDM({
    message: JSON.stringify({
      authoritativeCombatResults: resolvedActions,
      ...(encounterAlreadyConcluded ? { encounterAlreadyConcluded: true } : {}),
      // Named as refusals, not as results, and carrying no outcome to narrate — because there
      // is none. The engine rolled nothing for these.
      ...(refusedActions.length
        ? {
            refusedActions,
            refusedActionsNote:
              'These were REJECTED by the engine. They did not happen: no roll was made, no ' +
              'damage was dealt, no condition changed. Never narrate an outcome for them. If a ' +
              "refused action was the player's, say plainly that it is not their turn yet and " +
              'whose turn it is.',
          }
        : {}),
      ...(turnHolder ? { currentTurn: turnHolder.name ?? turnHolder.id } : {}),
      ...(playerTurn
        ? {
            turnHandoff: `End your response with: "${playerName}, what do you do?"`,
          }
        : {}),
    }),
    context: { ...aiContext, gameState: { ...aiContext.gameState, resolutionOnly: true } },
    conversationHistory: [
      ...conversationHistory,
      {
        id: `resolution-setup-${Date.now()}`,
        role: 'assistant' as const,
        content: setupText,
        timestamp: new Date(),
      },
    ],
    userPlan: userPlan || undefined,
    turnCount,
  });

  const narratedText = prependCombatEngineTranscript(
    narration?.text ?? '',
    orderedEngineTranscriptLines,
  );
  const handedOffText =
    playerTurn && !encounterAlreadyConcluded
      ? ensurePlayerTurnHandoff(narratedText, playerName)
      : narratedText;
  if (!refusedPlayerActions.length) {
    // After a successful repair the refusal is stale only if the turn came back to the player —
    // the handoff line then says so. If a creature still holds the turn, the player is told who
    // deterministically; a prompt instruction alone is the #1744 lockout.
    const repairNotice =
      playerRefusalRepaired && !playerTurn && !encounterAlreadyConcluded
        ? repairedTurnNotice(turnHolder)
        : null;
    if (repairNotice) {
      return {
        ...narration,
        combatEngineBlocks: orderedEngineBlocks,
        text: `${narratedText}\n\n${repairNotice}`.trim(),
      };
    }
    return orderedEngineTranscriptLines.length || handedOffText !== narratedText
      ? { ...narration, text: handedOffText, combatEngineBlocks: orderedEngineBlocks }
      : narration;
  }
  // Whose turn it is, stated by the engine rather than hoped for from the model. The prompt above
  // asks for it; this is the half that does not depend on compliance, and #1702 is the standing
  // argument for not leaving a rule the model follows half the time as the only guarantee.
  logger.warn(
    `[CombatRepair] player_action_refused actor=${refusedPlayerActions[0].actor} ` +
      `turn=${String(refusedPlayerActions[0].currentTurn ?? 'unknown')}`,
  );
  const notice = turnNotice(
    turnHolder,
    isPlayerActor(turnHolder?.id ?? '', participants),
    String(refusedPlayerActions[0].refusalReason ?? ''),
  );
  const refusedText = `${narratedText}\n\n${notice}`.trim();
  return {
    ...narration,
    combatEngineBlocks: orderedEngineBlocks,
    text:
      playerTurn && !encounterAlreadyConcluded
        ? ensurePlayerTurnHandoff(refusedText, playerName)
        : refusedText,
  };
}

/** What the player sees after dismissing an attack or spell prompt. */
export function withdrawnActionNotice(action: StructuredCombatAction): string {
  const what =
    action.action_type === 'cast_spell'
      ? `casting ${playerCombatSpellLabel(action.spell_id, action.spell_id)}`
      : 'that attack';
  return `You dismissed the roll, so ${what} did not happen. It is still your turn — what do you do?`;
}

function ensurePlayerTurnHandoff(text: string, playerName: string): string {
  const handoff = `${playerName}, what do you do?`;
  if (text.trimEnd().toLowerCase().endsWith(handoff.toLowerCase())) return text;
  return `${text}\n\n${handoff}`.trim();
}
