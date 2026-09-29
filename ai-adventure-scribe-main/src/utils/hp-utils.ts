/**
 * Utility functions for hit point (HP) related UI logic
 */

/**
 * Returns a semantic Tailwind background color class based on HP percentage
 * - Green (> 50%): Healthy
 * - Yellow (25% - 50%): Bloodied/Wounded
 * - Red (< 25%): Critical
 *
 * @param percent HP percentage (0-100)
 * @returns Tailwind background color class
 */
export const getHPColor = (percent: number): string => {
  if (percent <= 25) return 'bg-red-500';
  if (percent <= 50) return 'bg-yellow-500';
  return 'bg-green-500';
};

/**
 * Returns a semantic health status description based on HP percentage
 * - Healthy (> 50%)
 * - Bloodied (25% - 50%)
 * - Near Death (< 25%)
 * - Unconscious (0%)
 *
 * @param percent HP percentage (0-100)
 * @returns Semantic status string
 */
export const getHPStatusDescription = (percent: number): string => {
  if (percent <= 0) return 'Unconscious';
  if (percent <= 25) return 'Near Death';
  if (percent <= 50) return 'Bloodied';
  return 'Healthy';
};

export type EnemyHealthTier = 'Healthy' | 'Hurt' | 'Bloodied' | 'Down';

/**
 * The only health a player is shown for an enemy (#2257): a word, never a number.
 * - Down (0 HP)
 * - Bloodied (at or under half)
 * - Hurt (over half, at or under three quarters)
 * - Healthy (over three quarters)
 */
export const getEnemyHealthTier = (currentHp: number, maxHp: number): EnemyHealthTier => {
  if (currentHp <= 0) return 'Down';
  const percent = maxHp > 0 ? (currentHp / maxHp) * 100 : 0;
  if (percent <= 50) return 'Bloodied';
  if (percent <= 75) return 'Hurt';
  return 'Healthy';
};

/**
 * Bar colour for the player's own HP: good above half, warn at or under half, bad at or under a
 * quarter. `bg-emerald-500/80` is today's good colour; the `bg-ir-hp-*` tokens replace these
 * once ticket 3 lands.
 */
export const getPlayerHPBarColor = (percent: number): string => {
  if (percent <= 25) return 'bg-red-500';
  if (percent <= 50) return 'bg-amber-500';
  return 'bg-emerald-500/80';
};
