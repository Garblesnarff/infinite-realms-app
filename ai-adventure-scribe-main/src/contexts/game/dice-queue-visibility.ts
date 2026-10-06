import type { DiceRollRequest, DiceRollQueue } from '@/types/combat';

import logger from '@/lib/logger';

/**
 * Which queued roll is the one the player sees.
 *
 * Only one request is visible at a time. That is a product rule — two popups would ask the
 * player which of two dice they are rolling without telling them — but it means the order
 * matters: a request left queued behind another may never be answered.
 *
 * Engine-tagged requests (`combatAttackRoll` / `combatInitiativeRoll`) therefore take the slot
 * from an ordinary narrative roll. The engine is blocked awaiting that exact die and its prompt
 * auto-rolls on a timer, so leaving it behind a narrative check throws the player's roll away and
 * seats the encounter with a number they never rolled (#2190). Two engine prompts never compete:
 * the bridge allows one outstanding roll, so the first keeps the slot.
 */
export function isEngineTaggedRoll(roll: Pick<DiceRollRequest, 'id'> | undefined): boolean {
  if (!roll) return false;
  const tagged = roll as Partial<DiceRollRequest>;
  return Boolean(tagged.combatAttackRoll || tagged.combatInitiativeRoll || tagged.combatCheckRoll);
}

/** True when `incoming` must displace whatever request is currently visible. */
export function preemptsVisibleRoll(queue: DiceRollQueue, incoming: DiceRollRequest): boolean {
  if (!queue.currentRollId || !isEngineTaggedRoll(incoming)) return false;
  const visible = queue.pendingRolls.find((roll) => roll.id === queue.currentRollId);
  return !isEngineTaggedRoll(visible);
}

/** The visible roll id after `incoming` joins the queue. */
export function nextVisibleRollId(queue: DiceRollQueue, incoming: DiceRollRequest): string {
  if (preemptsVisibleRoll(queue, incoming)) {
    logger.info('🎲 Engine roll request takes the visible slot from a narrative roll:', {
      engineRollId: incoming.id,
      engineRollDescription: incoming.description,
      displacedRollId: queue.currentRollId,
    });
    return incoming.id;
  }
  return queue.currentRollId || incoming.id;
}
