import { ACTION_BAR_ACTOR_ID } from './combat-action-bar-intent';

/**
 * The authoritative intent body the action bar's flee branch sends (producer:
 * `executeAuthoritativeCombatIntent` called from useCombatLegalActions' flee branch, DM
 * dialect so no expectedVersion, origin action_bar; dmStartedAt is Date.now() at the click
 * and is not part of the constant).
 */
export const ACTION_BAR_FLEE_INTENT_BODY = {
  intent: { type: 'flee', actorId: ACTION_BAR_ACTOR_ID },
  source: 'dm',
  origin: 'action_bar',
} as const;
