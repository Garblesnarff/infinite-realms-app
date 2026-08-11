/* eslint-disable @typescript-eslint/no-explicit-any */
import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
  executeStructuredCombatAction,
} from '@/services/combat/combat-action-executor';
import { repairRefusedCombatAction } from '@/services/combat/combat-repair';

/**
 * Handing the DM's declared combat actions to the engine, and narrating what the engine did.
 *
 * Lifted verbatim out of `dm-actions-handler` when the zero-action guard pushed that file past
 * its line budget. Nothing here changed in the move: the same one-repair-per-turn budget, the
 * same surfacing of a second refusal, the same resolution-only narration pass. It reads better
 * as its own step regardless — the handler above it dispatches side effects, while this is the
 * one place where the engine is authoritative and the DM is merely reporting.
 */

export interface CombatResolutionParams {
  encounterId: string;
  combatActions: unknown[];
  /** The declaration the resolution narration is written against. */
  declarationText: string;
  aiContext: any;
  conversationHistory: any[];
  userPlan?: string;
  turnCount?: number;
}

/**
 * Resolves every targeted action, then asks the DM to narrate the outcomes the engine produced.
 * Returns the narration envelope; refusals it cannot repair are rethrown to the caller.
 */
export async function resolveDeclaredCombatActions(params: CombatResolutionParams): Promise<any> {
  const {
    encounterId,
    combatActions,
    declarationText,
    aiContext,
    conversationHistory,
    userPlan,
    turnCount,
  } = params;

  const resolvedActions: Array<Record<string, unknown>> = [];
  const targetedActions = combatActions.filter(
    (action: any): action is StructuredCombatAction => 'target_ids' in action,
  );
  // One repair attempt per turn, not per action: the budget belongs to the turn, and a DM
  // that got the actor wrong once will get it wrong for every action in the same batch.
  let repairSpent = false;
  const runAction = async (action: StructuredCombatAction): Promise<void> => {
    const outcomes = await executeStructuredCombatAction(encounterId, action);
    resolvedActions.push({ action, outcomes });
    await executeAuthoritativeCombatIntent(
      encounterId,
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
      // The original assigned `responseText = repaired.text` here. It was dead: the resolution
      // narration below overwrites `responseText` unconditionally on every path out of this
      // function, so the repaired declaration never reached the player either way. Dropped in
      // the extraction rather than carried across as a line that cannot have an effect.
    }
  }

  return AIService.chatWithDM({
    message: JSON.stringify({ authoritativeCombatResults: resolvedActions }),
    context: { ...aiContext, gameState: { ...aiContext.gameState, resolutionOnly: true } },
    conversationHistory: [
      ...conversationHistory,
      {
        id: `resolution-setup-${Date.now()}`,
        role: 'assistant' as const,
        content: declarationText,
        timestamp: new Date(),
      },
    ],
    userPlan: userPlan || undefined,
    turnCount,
  });
}
