import type { DiceRollQueue, DiceRollRequest } from '@/types/combat';

type LabeledRoll = DiceRollRequest & { purpose?: string };

/**
 * The pending request `state.diceRollQueue` is showing right now.
 * Read the queue on state. Do not call `getCurrentDiceRoll()` — that getter
 * reads a ref updated during render and lags the queue by one commit.
 */
export function currentQueueRoll(queue: DiceRollQueue | undefined): DiceRollRequest | null {
  if (!queue?.currentRollId) return null;
  return (
    queue.pendingRolls.find(
      (roll) => roll.id === queue.currentRollId && roll.status === 'pending',
    ) ?? null
  );
}

/** Engine rolls name the check on `description`; chat-shaped requests use `purpose`. */
export function queueRollLabel(roll: LabeledRoll): string {
  const purpose = roll.purpose?.trim();
  if (purpose) return purpose;
  const description = roll.description?.trim();
  if (description) return description;
  return roll.requestType;
}
