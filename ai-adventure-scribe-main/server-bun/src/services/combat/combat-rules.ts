export type WeaponRuleProfile = {
  id: string;
  name: string;
  damageDice: string;
  damageType: string;
  normalRange: number;
  longRange?: number;
  magicBonus: number;
  finesse: boolean;
  ranged: boolean;
  proficient: boolean;
};

export type AttackGeometry = {
  distanceFeet: number;
  hasLineOfSight: boolean;
  cover: 0 | 1 | 2 | 3;
};

export type AttackRuleInput = {
  strength: number;
  dexterity: number;
  level: number;
  baseTargetAc: number;
  weapon: WeaponRuleProfile;
  geometry?: AttackGeometry;
  requestedAdvantage?: boolean;
  requestedDisadvantage?: boolean;
  attackerConditions?: string[];
  targetConditions?: string[];
};

export type AttackRuleResolution = {
  legal: boolean;
  refusal?: 'no_line_of_sight' | 'out_of_range' | 'total_cover';
  ability: 'strength' | 'dexterity';
  abilityModifier: number;
  proficiencyBonus: number;
  attackBonus: number;
  damageBonus: number;
  targetAc: number;
  advantage: boolean;
  disadvantage: boolean;
};

export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);
export const proficiencyBonus = (level: number): number => 2 + Math.floor((Math.max(1, level) - 1) / 4);

const includes = (conditions: string[], names: string[]): boolean =>
  conditions.some((condition) => names.includes(condition.toLowerCase()));

/** Pure D&D 5E attack validation/calculation used by every server action source. */
export function resolveAttackRules(input: AttackRuleInput): AttackRuleResolution {
  const { weapon, geometry } = input;
  const ability = weapon.ranged
    ? 'dexterity'
    : weapon.finesse && input.dexterity > input.strength
      ? 'dexterity'
      : 'strength';
  const modifier = abilityModifier(ability === 'dexterity' ? input.dexterity : input.strength);
  const proficiency = weapon.proficient ? proficiencyBonus(input.level) : 0;
  const attackerConditions = input.attackerConditions ?? [];
  const targetConditions = input.targetConditions ?? [];

  if (geometry && !geometry.hasLineOfSight) {
    return illegal('no_line_of_sight', ability, modifier, proficiency, input);
  }
  if (geometry?.cover === 3) {
    return illegal('total_cover', ability, modifier, proficiency, input);
  }
  if (geometry && geometry.distanceFeet > (weapon.longRange ?? weapon.normalRange)) {
    return illegal('out_of_range', ability, modifier, proficiency, input);
  }

  let hasAdvantage = Boolean(input.requestedAdvantage);
  let hasDisadvantage = Boolean(input.requestedDisadvantage);
  if (geometry && geometry.distanceFeet > weapon.normalRange) hasDisadvantage = true;
  // Ranged attacks made while an enemy is within 5 feet are disadvantaged.
  if (geometry && weapon.ranged && geometry.distanceFeet <= 5) hasDisadvantage = true;
  if (includes(attackerConditions, ['blinded', 'poisoned', 'frightened', 'restrained'])) hasDisadvantage = true;
  if (includes(targetConditions, ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned', 'unconscious'])) hasAdvantage = true;
  // Advantage and disadvantage cancel regardless of how many sources apply.
  const advantage = hasAdvantage && !hasDisadvantage;
  const disadvantage = hasDisadvantage && !hasAdvantage;
  const coverBonus = geometry?.cover === 1 ? 2 : geometry?.cover === 2 ? 5 : 0;

  return {
    legal: true,
    ability,
    abilityModifier: modifier,
    proficiencyBonus: proficiency,
    attackBonus: modifier + proficiency + weapon.magicBonus,
    damageBonus: modifier + weapon.magicBonus,
    targetAc: input.baseTargetAc + coverBonus,
    advantage,
    disadvantage,
  };
}

function illegal(
  refusal: NonNullable<AttackRuleResolution['refusal']>,
  ability: AttackRuleResolution['ability'],
  modifier: number,
  proficiency: number,
  input: AttackRuleInput,
): AttackRuleResolution {
  return {
    legal: false,
    refusal,
    ability,
    abilityModifier: modifier,
    proficiencyBonus: proficiency,
    attackBonus: modifier + proficiency + input.weapon.magicBonus,
    damageBonus: modifier + input.weapon.magicBonus,
    targetAc: input.baseTargetAc,
    advantage: false,
    disadvantage: false,
  };
}
