/**
 * The only health detail that belongs in player-facing combat reporting.
 *
 * Numeric hit points remain an engine concern. These four tiers are the same vocabulary the DM
 * prompt permits, so the client can report the state the HP write actually produced without
 * calculating a condition from stale client state.
 */
export type CombatHealthCondition = 'unharmed' | 'wounded' | 'bloodied' | 'near death';

export function healthConditionForCombat(
  currentHp: number,
  maxHp: number,
  isConscious = true,
  isDead = false,
): CombatHealthCondition {
  if (isDead || !isConscious || currentHp <= 0 || maxHp <= 0) return 'near death';
  if (currentHp >= maxHp) return 'unharmed';
  if (currentHp > maxHp / 2) return 'wounded';
  if (currentHp > maxHp / 4) return 'bloodied';
  return 'near death';
}
