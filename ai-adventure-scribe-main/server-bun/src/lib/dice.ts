import { rollDie } from './rng.js';

/**
 * Server-owned dice primitives.
 *
 * Keeping the d20 roll here makes narrative and combat rolls use the same
 * engine-owned source of randomness. Advantage and disadvantage intentionally
 * preserve the combat resolver's existing semantics, including the normal-roll
 * result when both flags are set.
 */
export function rollD20(advantage = false, disadvantage = false): number {
  return rollD20Pair(advantage, disadvantage).kept;
}

/**
 * The kept d20 and, when advantage or disadvantage rolled a second die, that die too.
 * `rollD20` discards the second die, which is why a disadvantaged attack could only ever
 * show one d20 in the log (#263 CB-028): the transcript needs both dice and the kept one.
 */
export function rollD20Pair(
  advantage = false,
  disadvantage = false,
): { kept: number; other?: number } {
  const first = rollDie(20);
  if (advantage === disadvantage) return { kept: first };
  const second = rollDie(20);
  return advantage
    ? { kept: Math.max(first, second), other: Math.min(first, second) }
    : { kept: Math.min(first, second), other: Math.max(first, second) };
}
