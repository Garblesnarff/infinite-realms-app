/**
 * Server-owned dice primitives.
 *
 * Keeping the d20 roll here makes narrative and combat rolls use the same
 * engine-owned source of randomness. Advantage and disadvantage intentionally
 * preserve the combat resolver's existing semantics, including the normal-roll
 * result when both flags are set.
 */
export function rollD20(advantage = false, disadvantage = false): number {
  const first = Math.floor(Math.random() * 20) + 1;
  if (advantage === disadvantage) return first;
  const second = Math.floor(Math.random() * 20) + 1;
  return advantage ? Math.max(first, second) : Math.min(first, second);
}
