/** Validate a declared Reckless Attack before a proposal or resource claim. */
export function recklessAttackRefusal(input: {
  barbarianLevel: number;
  firstAttack: boolean;
  meleeWeapon: boolean;
  strengthAttack: boolean;
}): string | null {
  if (input.barbarianLevel === 0) return 'Reckless Attack requires the Barbarian class.';
  if (input.barbarianLevel < 2) return 'Reckless Attack requires Barbarian level 2.';
  if (!input.firstAttack)
    return 'Reckless Attack must be declared on your first attack of the turn.';
  if (!input.meleeWeapon) return 'Reckless Attack requires a melee weapon attack.';
  if (!input.strengthAttack) return 'Reckless Attack requires an attack using Strength.';
  return null;
}
