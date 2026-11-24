import { abilityModifier } from './ability-modifier';
import { proficiencyBonus } from './proficiency-bonus';

export type CombatCheckModifierKind =
  | 'shove'
  | 'grapple'
  | 'escape'
  | 'hide'
  | 'search'
  | 'persuade'
  | 'intimidate';

export interface CombatCheckModifierProfile {
  scores: Partial<Record<'str' | 'dex' | 'wis' | 'cha', number>>;
  level: number;
  skillProficiencies?: readonly string[];
}

const skillName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const hasSkill = (profile: CombatCheckModifierProfile, skill: string): boolean => {
  const target = skillName(skill);
  return (profile.skillProficiencies ?? []).some((entry) => skillName(entry) === target);
};

const scoreOf = (
  profile: CombatCheckModifierProfile,
  ability: 'str' | 'dex' | 'wis' | 'cha',
): number => {
  const score = profile.scores[ability];
  return typeof score === 'number' && Number.isFinite(score) ? score : 10;
};

const skillModifier = (
  profile: CombatCheckModifierProfile,
  ability: 'str' | 'dex' | 'wis' | 'cha',
  skill: string,
): number =>
  abilityModifier(scoreOf(profile, ability)) +
  (hasSkill(profile, skill) ? proficiencyBonus(profile.level) : 0);

/** The single modifier owner shared by the client trays and server check resolver. */
export function combatCheckModifierFor(
  profile: CombatCheckModifierProfile,
  kind: CombatCheckModifierKind,
): number {
  switch (kind) {
    case 'shove':
    case 'grapple':
      return skillModifier(profile, 'str', 'Athletics');
    case 'escape':
      return Math.max(
        skillModifier(profile, 'str', 'Athletics'),
        skillModifier(profile, 'dex', 'Acrobatics'),
      );
    case 'hide':
      return skillModifier(profile, 'dex', 'Stealth');
    case 'search':
      return skillModifier(profile, 'wis', 'Perception');
    case 'persuade':
      return skillModifier(profile, 'cha', 'Persuasion');
    case 'intimidate':
      return skillModifier(profile, 'cha', 'Intimidation');
  }
}
