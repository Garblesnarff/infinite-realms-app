import { abilityModifier } from '../../../../shared/ability-modifier';
import { proficiencyBonus } from '../../../../shared/proficiency-bonus';

export type WeaponRuleProfile = {
  missingAmmunition?: 'bolts' | 'arrows';
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
  /**
   * A to-hit bonus that is already complete, used verbatim instead of being rebuilt from
   * ability modifier + proficiency + magic.
   *
   * Monsters need this and player characters must never set it. A stat block prints one
   * finished number ("+10 to hit") that folds in Strength, proficiency and any magic the
   * designer priced in; there is no decomposition to recover, and a monster participant has
   * no ability scores to recover it from -- `getParticipantAbilityProfile` returns `{}` for a
   * combatant with neither a character nor an NPC row, so every modifier reads +0. Rebuilding
   * from parts is what made a CR 10 golem swing at +2.
   *
   * Player weapons leave this undefined and take the computed path below, unchanged.
   */
  fixedAttackBonus?: number;
  /**
   * The flat damage addend that belongs with `fixedAttackBonus`. Same reasoning: the SRD's
   * `3d8 + 6` states its own +6, which is not the monster's (nonexistent) Strength modifier.
   */
  fixedDamageBonus?: number;
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
  /**
   * The target took the Dodge action. Dodge imposes disadvantage on attacks against it, and
   * it is its own player-facing reason rather than a second "requested" source (#603).
   */
  targetDodging?: boolean;
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
  /** Short player-facing reasons behind each advantage source, in the order they applied. */
  advantageSources: string[];
  /** Short player-facing reasons behind each disadvantage source, in the order they applied. */
  disadvantageSources: string[];
};

export { abilityModifier };
export { proficiencyBonus };

/** Conditions that impose disadvantage on the attacker's own attacks (2014 5e). */
const ATTACKER_DISADVANTAGE_CONDITIONS = ['blinded', 'poisoned', 'frightened', 'restrained'];
/** Conditions on the target that grant the attacker advantage (2014 5e). */
const TARGET_ADVANTAGE_CONDITIONS = [
  'blinded',
  'paralyzed',
  'petrified',
  'restrained',
  'stunned',
  'unconscious',
];

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

  const advantageSources: string[] = [];
  const disadvantageSources: string[] = [];
  if (input.requestedAdvantage) advantageSources.push('requested');
  if (input.requestedDisadvantage) disadvantageSources.push('requested');
  if (input.targetDodging) disadvantageSources.push('target is dodging');
  if (geometry && geometry.distanceFeet > weapon.normalRange)
    disadvantageSources.push('long range');
  // Ranged attacks made while an enemy is within 5 feet are disadvantaged.
  if (geometry && weapon.ranged && geometry.distanceFeet <= 5)
    disadvantageSources.push('ranged attack with a hostile within 5 ft');
  for (const condition of ATTACKER_DISADVANTAGE_CONDITIONS) {
    if (includes(attackerConditions, [condition])) disadvantageSources.push(`you are ${condition}`);
  }
  for (const condition of TARGET_ADVANTAGE_CONDITIONS) {
    if (includes(targetConditions, [condition])) advantageSources.push(`target is ${condition}`);
  }
  const hasAdvantage = advantageSources.length > 0;
  const hasDisadvantage = disadvantageSources.length > 0;
  // Advantage and disadvantage cancel regardless of how many sources apply.
  const advantage = hasAdvantage && !hasDisadvantage;
  const disadvantage = hasDisadvantage && !hasAdvantage;
  const coverBonus = geometry?.cover === 1 ? 2 : geometry?.cover === 2 ? 5 : 0;

  return {
    legal: true,
    ability,
    abilityModifier: modifier,
    proficiencyBonus: proficiency,
    attackBonus: weapon.fixedAttackBonus ?? modifier + proficiency + weapon.magicBonus,
    damageBonus: weapon.fixedDamageBonus ?? modifier + weapon.magicBonus,
    targetAc: input.baseTargetAc + coverBonus,
    advantage,
    disadvantage,
    advantageSources,
    disadvantageSources,
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
    attackBonus: input.weapon.fixedAttackBonus ?? modifier + proficiency + input.weapon.magicBonus,
    damageBonus: input.weapon.fixedDamageBonus ?? modifier + input.weapon.magicBonus,
    targetAc: input.baseTargetAc,
    advantage: false,
    disadvantage: false,
    advantageSources: [],
    disadvantageSources: [],
  };
}
