/**
 * Character Roll Breakdown Utilities
 *
 * Handles generating dice formulas, calculating roll breakdowns, and representing
 * character stats for AI context.
 * Extracted from characterModifiers.ts
 *
 * @author AI Dungeon Master Team
 */

import {
  type AbilityName,
  SKILL_ABILITIES,
  SKILL_ALIASES,
  getAbilityModifier,
  getProficiencyBonus,
  isSkillProficient,
  isSaveProficient,
} from './basic-modifiers';
import { hasProficiency } from './parse-proficiency-list';

import type { Character } from '@/types/character';

/**
 * Generate dice formula with character modifiers
 */
export function generateDiceFormula(
  diceType: number = 20,
  diceCount: number = 1,
  modifier: number = 0,
): string {
  const modifierStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  return `${diceCount}d${diceType}${modifier !== 0 ? modifierStr : ''}`;
}

/**
 * Create a complete roll request with character modifiers
 */
export interface RollCalculation {
  formula: string;
  baseModifier: number;
  abilityModifier: number;
  proficiencyBonus: number;
  totalModifier: number;
  isProficient: boolean;
  ability?: AbilityName;
  breakdown: string[];
}

/**
 * Calculate roll with character modifiers and breakdown
 */
export function calculateRollWithBreakdown(
  character: Character,
  rollType: 'attack' | 'save' | 'check' | 'skill' | 'initiative',
  ability?: AbilityName,
  skillName?: string,
): RollCalculation {
  let abilityMod = 0;
  let proficiencyBonus = 0;
  let isProficient = false;
  let usedAbility: AbilityName | undefined = ability;
  const breakdown: string[] = ['1d20'];

  switch (rollType) {
    case 'attack':
      // Default to strength for melee attacks
      usedAbility = ability || 'strength';
      abilityMod = getAbilityModifier(character, usedAbility);
      proficiencyBonus = getProficiencyBonus(character); // Assume weapon proficiency
      isProficient = true;
      breakdown.push(
        `${usedAbility.slice(0, 3).toUpperCase()} ${abilityMod >= 0 ? '+' : ''}${abilityMod}`,
      );
      breakdown.push(`Prof +${proficiencyBonus}`);
      break;

    case 'save':
      if (!ability) {
        throw new Error('Ability required for saving throw');
      }
      usedAbility = ability;
      abilityMod = getAbilityModifier(character, ability);
      isProficient = isSaveProficient(character, ability);
      proficiencyBonus = isProficient ? getProficiencyBonus(character) : 0;
      breakdown.push(
        `${ability.slice(0, 3).toUpperCase()} ${abilityMod >= 0 ? '+' : ''}${abilityMod}`,
      );
      if (isProficient) {
        breakdown.push(`Prof +${proficiencyBonus}`);
      }
      break;

    case 'check':
      if (!ability) {
        throw new Error('Ability required for ability check');
      }
      usedAbility = ability;
      abilityMod = getAbilityModifier(character, ability);
      if (
        skillName &&
        character.toolProficiencies?.some((tool) => tool.toLowerCase() === skillName.toLowerCase())
      ) {
        isProficient = true;
        proficiencyBonus = getProficiencyBonus(character);
      }
      breakdown.push(
        `${ability.slice(0, 3).toUpperCase()} ${abilityMod >= 0 ? '+' : ''}${abilityMod}`,
      );
      if (isProficient) {
        breakdown.push(`${skillName} Prof +${proficiencyBonus}`);
      }
      break;

    case 'skill': {
      if (!skillName) {
        throw new Error('Skill name required for skill check');
      }
      const normalizedSkill = skillName.toLowerCase();
      const actualSkill = SKILL_ALIASES[normalizedSkill] || normalizedSkill;
      const skillAbility = SKILL_ABILITIES[actualSkill];
      if (!skillAbility) {
        throw new Error(`Unknown skill: ${skillName}`);
      }

      usedAbility = skillAbility;
      abilityMod = getAbilityModifier(character, skillAbility);
      isProficient = isSkillProficient(character, skillName);
      const hasExpertise = hasProficiency(character.expertiseProficiencies, actualSkill);
      proficiencyBonus = isProficient ? getProficiencyBonus(character) * (hasExpertise ? 2 : 1) : 0;
      breakdown.push(
        `${skillAbility.slice(0, 3).toUpperCase()} ${abilityMod >= 0 ? '+' : ''}${abilityMod}`,
      );
      if (isProficient) {
        breakdown.push(`Prof +${proficiencyBonus}`);
      }
      break;
    }

    case 'initiative':
      usedAbility = 'dexterity';
      abilityMod = getAbilityModifier(character, 'dexterity');
      breakdown.push(`DEX ${abilityMod >= 0 ? '+' : ''}${abilityMod}`);
      break;
  }

  const totalModifier = abilityMod + proficiencyBonus;
  const formula = generateDiceFormula(20, 1, totalModifier);

  return {
    formula,
    baseModifier: 0, // For d20 rolls, base is always 0
    abilityModifier: abilityMod,
    proficiencyBonus,
    totalModifier,
    isProficient,
    ability: usedAbility,
    breakdown,
  };
}

/**
 * Get character summary for AI context
 */
export function getCharacterStatsForAI(character: Character): string {
  const stats = character.abilityScores;
  if (!stats) {
    return 'No ability scores available';
  }

  const profBonus = getProficiencyBonus(character);

  return `Level ${character.level} ${character.race?.name || 'Unknown'} ${character.class?.name || 'Unknown'}
Ability Scores: STR ${stats.strength?.score}(${stats.strength?.modifier >= 0 ? '+' : ''}${stats.strength?.modifier}), DEX ${stats.dexterity?.score}(${stats.dexterity?.modifier >= 0 ? '+' : ''}${stats.dexterity?.modifier}), CON ${stats.constitution?.score}(${stats.constitution?.modifier >= 0 ? '+' : ''}${stats.constitution?.modifier}), INT ${stats.intelligence?.score}(${stats.intelligence?.modifier >= 0 ? '+' : ''}${stats.intelligence?.modifier}), WIS ${stats.wisdom?.score}(${stats.wisdom?.modifier >= 0 ? '+' : ''}${stats.wisdom?.modifier}), CHA ${stats.charisma?.score}(${stats.charisma?.modifier >= 0 ? '+' : ''}${stats.charisma?.modifier})
Proficiency Bonus: +${profBonus}`;
}
