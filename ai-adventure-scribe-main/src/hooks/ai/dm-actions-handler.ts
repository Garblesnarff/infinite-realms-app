/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  DMAoESpellAction,
  DMHandoutAction,
} from '../../../server-bun/src/services/dm/dm-response-schema';
import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';
import type { JournalHandoutEntry, TacticalMapActionPayload } from '@/services/user-data-api';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
  executeStructuredCombatAction,
} from '@/services/combat/combat-action-executor';
import { repairRefusedCombatAction } from '@/services/combat/combat-repair';
import { combatStartErrorFromResponse } from '@/services/combat/combat-start-failure';
import { notifyRetryableCombatStartFailure } from '@/services/combat/combat-start-toast';
import { startStructuredCombatTransition } from '@/services/combat/structured-combat-transition';
import { userDataApi } from '@/services/user-data-api';

export interface HandleDmActionsParams {
  sessionId: string;
  result: any;
  characterRecord: Record<string, unknown>;
  activeEncounter: any;
  isInCombat: boolean;
  refreshCombatState: () => Promise<any>;
  aiContext: any;
  conversationHistory: any[];
  userPlan?: string;
  turnCount?: number;
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
    characterRecord,
    refreshCombatState,
    aiContext,
    conversationHistory,
    userPlan,
    turnCount,
  } = params;

  let { result, activeEncounter, isInCombat } = params;
  let responseText = result.text;
  let narrationSegments = result.narrationSegments;
  let deliveredHandouts: JournalHandoutEntry[] | undefined;

  // A structured start is server-authoritative: the same transaction creates
  // combat participants (whose IDs become tactical entity IDs) and the map.
  if (sessionId && result.combat_transition === 'start' && result.scene_spec) {
    const envelope = result as Parameters<typeof startStructuredCombatTransition>[2];
    const attemptStart = async (): Promise<void> => {
      const startResponse = await startStructuredCombatTransition(
        sessionId,
        characterRecord,
        envelope,
      );
      if (startResponse?.ok) {
        return;
      }
      // The failure is recoverable: the map simply was not created, so let the player
      // retry the same start instead of stranding the scene mid-transition.
      const failure = await combatStartErrorFromResponse(startResponse ?? null, envelope);
      logger.warn('Server refused structured combat start', failure.toTranscriptDetail());
      notifyRetryableCombatStartFailure(failure, attemptStart);
    };
    await attemptStart();
  }

  if (sessionId && result.combat_transition === 'end') {
    const endResponse = await userDataApi.endTacticalMap(sessionId);
    if (!endResponse.ok) {
      logger.warn('Server refused tactical combat end', await endResponse.json());
    }
  }

  // A transition just moved the board. Re-read rather than wait for the broadcast to land
  // in a later render: a start that also carries combat_actions has to resolve them on this
  // turn, and the resolution prompt below has to be told the fight is on.
  if (sessionId && (result.combat_transition === 'start' || result.combat_transition === 'end')) {
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
    const resolvedActions: Array<Record<string, unknown>> = [];
    const targetedActions = result.combat_actions.filter(
      (action: any): action is StructuredCombatAction => 'target_ids' in action,
    );
    // One repair attempt per turn, not per action: the budget belongs to the turn, and a DM
    // that got the actor wrong once will get it wrong for every action in the same batch.
    let repairSpent = false;
    const runAction = async (action: StructuredCombatAction): Promise<void> => {
      const outcomes = await executeStructuredCombatAction(activeEncounter.id, action);
      resolvedActions.push({ action, outcomes });
      await executeAuthoritativeCombatIntent(
        activeEncounter.id,
        { type: 'end_turn', actorId: action.actor_id },
        'dm',
      );
    };
    for (const action of targetedActions) {
      try {
        await runAction(action);
      } catch (error) {
        if (!(error instanceof CombatIntentRefusedError) || repairSpent) throw error;
        repairSpent = true;
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
          throw error;
        }
        // The corrected turn replaces the refused one. A second refusal is not repaired again.
        for (const correctedAction of corrected) await runAction(correctedAction);
        logger.info('[CombatRepair] outcome=repaired');
        // The repaired narration is what the player should read, not the refused declaration.
        if (repaired.text) responseText = repaired.text;
      }
    }
    const narrationResult = await AIService.chatWithDM({
      message: JSON.stringify({ authoritativeCombatResults: resolvedActions }),
      context: { ...aiContext, gameState: { ...aiContext.gameState, resolutionOnly: true } },
      conversationHistory: [
        ...conversationHistory,
        {
          id: `resolution-setup-${Date.now()}`,
          role: 'assistant' as const,
          content: result.text,
          timestamp: new Date(),
        },
      ],
      userPlan: userPlan || undefined,
      turnCount,
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
