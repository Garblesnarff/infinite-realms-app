import type { DiceRollQueue, DiceRollRequest } from '@/types/combat';

type LabeledRoll = DiceRollRequest & { purpose?: string };

/**
 * The roll the player has to resolve right now. Prefer `getCurrentDiceRoll()`
 * (same pending + currentRollId rule) and fall back to the queue on state so a
 * render still sees the request if the getter is stale.
 */
export function currentQueueRoll(
  queue: DiceRollQueue | undefined,
  fromGetter: DiceRollRequest | null | undefined,
): DiceRollRequest | null {
  if (fromGetter?.status === 'pending') {
    return fromGetter;
  }
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
