/**
 * Utility functions for hit point (HP) related UI logic
 */
import type { CombatHealthCondition } from '@/services/combat/health-condition';

import { healthConditionForCombat } from '@/services/combat/health-condition';

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
 * The player's own hidden-HP word. Same cuts as healthConditionForCombat (#863).
 * A percent is current HP out of 100, so the engine function owns the tier.
 */
export const getHPStatusDescription = (percent: number): CombatHealthCondition =>
  healthConditionForCombat(percent, 100);

export type EnemyHealthTier = CombatHealthCondition;

/**
 * The only health a player is shown for an enemy (#2257): the engine tier, never a number.
 */
export const getEnemyHealthTier = (currentHp: number, maxHp: number): EnemyHealthTier =>
  healthConditionForCombat(currentHp, maxHp);

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
