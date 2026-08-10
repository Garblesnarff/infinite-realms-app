import type {
  CombatIntentRefusedError,
  StructuredCombatAction,
} from '@/services/combat/combat-action-executor';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';

/**
 * One corrective regeneration after the engine refuses a DM-declared combat action.
 *
 * The engine's refusals are correct and the DM's declarations are not: on 2026-08-10 the DM
 * declared an attack for `the-seeker` while `sentient-glaze` held the turn, and the engine
 * answered 422. Nothing caught it, so the raw refusal text surfaced to the player as an error
 * in place of a narrated turn. A model that cannot be instructed out of a habit can still be
 * *told it was wrong and asked again* — the same bet `ensureActionOptions` makes when the DM
 * omits action options, and this mirrors its shape deliberately.
 *
 * Exactly one retry, and only for refusals the DM could plausibly fix (422 out-of-turn, 404
 * unresolvable reference). A second regeneration on the same turn is a loop that spends the
 * player's latency budget re-asking a model that has already demonstrated it will not comply;
 * the failure is surfaced instead, having been given its one chance.
 */

export interface CombatRepairParams {
  refusal: CombatIntentRefusedError;
  /** The action the engine refused, echoed back so the DM can see what it declared. */
  refusedAction: StructuredCombatAction;
  aiContext: unknown;
  conversationHistory: unknown[];
  userPlan?: string;
  turnCount?: number;
}

/**
 * The correction the DM is handed. Deliberately states the engine's answer verbatim, the board
 * roster, and whose turn it actually is, then asks for the same turn declared correctly.
 */
export function buildRepairPrompt(
  refusal: CombatIntentRefusedError,
  refusedAction: StructuredCombatAction,
): string {
  const details = refusal.details ?? {};
  const current = details.currentParticipantSlug
    ? `The entity whose turn it actually is: ${details.currentParticipantSlug}.`
    : '';
  const roster = details.roster ? `Entities on the board: ${details.roster}.` : '';
  const missed =
    details.role && details.id
      ? `The ${details.role} reference "${details.id}" named nothing on the board.`
      : '';
  return [
    'ENGINE REFUSED YOUR LAST COMBAT ACTION. It was not applied and the turn has not advanced.',
    `Refusal: ${refusal.message}`,
    `You declared: ${refusedAction.action_type} by "${refusedAction.actor_id}"` +
      `${refusedAction.target_ids?.length ? ` against ${refusedAction.target_ids.join(', ')}` : ''}.`,
    missed,
    current,
    roster,
    'Re-declare this turn correctly. Act only as the current-turn entity, address entities only',
    'by the ids listed above, and narrate that turn. Return the corrected action in',
    'combat_actions. Do not mention this correction, the engine, or any error to the player.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Asks the DM for one corrected turn. Returns the regenerated result, or `null` when the
 * refusal is not repairable or the regeneration itself fails — callers fall back to surfacing
 * the original refusal, never to a silent no-op.
 */
export async function repairRefusedCombatAction(
  params: CombatRepairParams,
): Promise<{ text: string; combat_actions?: StructuredCombatAction[] } | null> {
  const { refusal, refusedAction, aiContext, conversationHistory, userPlan, turnCount } = params;
  if (!refusal.isRepairable) {
    logger.warn(
      `[CombatRepair] outcome=not_repairable status=${refusal.status} reason=${refusal.message}`,
    );
    return null;
  }
  logger.warn(
    `[CombatRepair] attempt status=${refusal.status} actor=${refusedAction.actor_id} ` +
      `action=${refusedAction.action_type} reason=${refusal.message}`,
  );
  try {
    const regenerated = await AIService.chatWithDM({
      message: buildRepairPrompt(refusal, refusedAction),
      context: aiContext as never,
      conversationHistory: conversationHistory as never,
      userPlan,
      turnCount,
    });
    const actions = (regenerated as { combat_actions?: StructuredCombatAction[] })?.combat_actions;
    logger.info(
      `[CombatRepair] outcome=regenerated actions=${actions?.length ?? 0} ` +
        `actor=${actions?.[0]?.actor_id ?? 'none'}`,
    );
    return regenerated as { text: string; combat_actions?: StructuredCombatAction[] };
  } catch (error) {
    logger.warn('[CombatRepair] outcome=regeneration_failed', error);
    return null;
  }
}
