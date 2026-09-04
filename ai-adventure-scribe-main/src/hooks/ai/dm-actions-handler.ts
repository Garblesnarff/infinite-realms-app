/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  DMAoESpellAction,
  DMHandoutAction,
} from '../../../server-bun/src/services/dm/dm-response-schema';
import type { JournalHandoutEntry, TacticalMapActionPayload } from '@/services/user-data-api';

import { resolveDeclaredCombatActions } from '@/hooks/ai/combat-resolution-step';
import logger from '@/lib/logger';
import { enforceCombatActionOnAttempt } from '@/services/combat/combat-zero-action-guard';
import { userDataApi } from '@/services/user-data-api';

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
  } = params;

  let { result, activeEncounter, isInCombat } = params;
  let responseText = result.text;
  let narrationSegments = result.narrationSegments;
  let deliveredHandouts: JournalHandoutEntry[] | undefined;

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
  const forcedActions = await enforceCombatActionOnAttempt({
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

  if (isInCombat && activeEncounter && result.combat_actions?.length) {
    const narrationResult = await resolveDeclaredCombatActions({
      encounterId: activeEncounter.id,
      combatActions: result.combat_actions,
      declarationText: result.text,
      participants: activeEncounter.participants,
      aiContext,
      conversationHistory,
      userPlan,
      turnCount,
      queuedIntentActorIds: activeEncounter?.pendingIntent?.actorId
        ? [activeEncounter.pendingIntent.actorId]
        : [],
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
  };
}
