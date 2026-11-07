import type { DiceRollRequest } from '@/types/combat';

export interface DiceRollOutcome {
  success: boolean;
  target: number;
  targetType: 'dc' | 'ac';
}

/** Resolve the dice engine's result against the same target sent to the game turn. */
export function outcomeForRoll(roll: DiceRollRequest): DiceRollOutcome | undefined {
  if (!roll.result) return undefined;
  if (typeof roll.dc === 'number') {
    return { success: roll.result.total >= roll.dc, target: roll.dc, targetType: 'dc' };
  }
  if (typeof roll.ac === 'number' && roll.requestType === 'attack') {
    return { success: roll.result.total >= roll.ac, target: roll.ac, targetType: 'ac' };
  }
  return undefined;
}
