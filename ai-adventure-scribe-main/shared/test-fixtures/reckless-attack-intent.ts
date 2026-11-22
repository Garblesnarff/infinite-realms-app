/** The exact action-bar attack and proposal sent through the combat intent route. */
export const RECKLESS_ACTOR_ID = 'barbarian-1';
export const RECKLESS_TARGET_ID = 'orc-1';
export const RECKLESS_WEAPON_ID = 'longsword';
export const RECKLESS_ATTACK_INTENT = {
  type: 'attack' as const,
  actorId: RECKLESS_ACTOR_ID,
  targetId: RECKLESS_TARGET_ID,
  weaponId: RECKLESS_WEAPON_ID,
  reckless: true,
};
export const recklessAttackBody = () => ({
  intent: { ...RECKLESS_ATTACK_INTENT },
  source: 'dm' as const,
});
export const recklessProposeBody = () => ({ ...recklessAttackBody(), phase: 'propose' as const });
