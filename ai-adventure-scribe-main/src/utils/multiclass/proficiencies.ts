/**
 * Multiclassing Proficiency Calculations for D&D 5e
 * Extracted from src/utils/multiclassing.ts
 */

import type { AbilityScores, Character } from '@/types/character';

import { multiclassProficiencies } from '@/data/levelProgression';

export interface MulticlassProficiencyResult {
  armor: string[];
  weapons: string[];
  tools: string[];
  savingThrows: (keyof AbilityScores)[];
  skillChoices: string[];
  numSkillChoices: number;
}

/**
 * Calculate combined proficiencies for a multiclass character
 */
export function calculateMulticlassProficiencies(
  character: Character,
): MulticlassProficiencyResult {
  const result: MulticlassProficiencyResult = {
    armor: [],
    weapons: [],
    tools: [],
    savingThrows: [],
    skillChoices: [],
    numSkillChoices: 0,
  };

  // Track what we've already added to avoid duplicates
  const addedArmor = new Set<string>();
  const addedWeapons = new Set<string>();
  const addedTools = new Set<string>();
  const addedSavingThrows = new Set<keyof AbilityScores>();

  // Add proficiencies from first class
  if (character.class) {
    const firstClassProfs = multiclassProficiencies[character.class.name.toLowerCase()] || {};

    // Add armor proficiencies
    if (firstClassProfs.armor) {
      firstClassProfs.armor.forEach((armor) => {
        if (!addedArmor.has(armor)) {
          result.armor.push(armor);
          addedArmor.add(armor);
        }
      });
    }

    // Add weapon proficiencies
    if (firstClassProfs.weapons) {
      firstClassProfs.weapons.forEach((weapon) => {
        if (!addedWeapons.has(weapon)) {
          result.weapons.push(weapon);
          addedWeapons.add(weapon);
        }
      });
    }

    // Add tool proficiencies
    if (firstClassProfs.tools) {
      firstClassProfs.tools.forEach((tool) => {
        if (!addedTools.has(tool)) {
          result.tools.push(tool);
          addedTools.add(tool);
        }
      });
    }

    // Add saving throw proficiencies from first class
    if (character.class.savingThrowProficiencies) {
      character.class.savingThrowProficiencies.forEach((st) => {
        if (!addedSavingThrows.has(st)) {
          result.savingThrows.push(st);
          addedSavingThrows.add(st);
        }
      });
    }

    // Add skill choices from first class
    if (firstClassProfs.skillChoices) {
      result.skillChoices = [...firstClassProfs.skillChoices];
      result.numSkillChoices = firstClassProfs.numSkillChoices || 0;
    }
  }

  // Add proficiencies from additional classes
  if (character.classLevels && character.classLevels.length > 1) {
    // Skip first class (already processed)
    for (let i = 1; i < character.classLevels.length; i++) {
      const classLevel = character.classLevels[i];
      const classProfs = multiclassProficiencies[classLevel.className.toLowerCase()] || {};

      // Add armor proficiencies
      if (classProfs.armor) {
        classProfs.armor.forEach((armor) => {
          if (!addedArmor.has(armor)) {
            result.armor.push(armor);
            addedArmor.add(armor);
          }
        });
      }

      // Add weapon proficiencies
      if (classProfs.weapons) {
        classProfs.weapons.forEach((weapon) => {
          if (!addedWeapons.has(weapon)) {
            result.weapons.push(weapon);
            addedWeapons.add(weapon);
          }
        });
      }

      // Add tool proficiencies
      if (classProfs.tools) {
        classProfs.tools.forEach((tool) => {
          if (!addedTools.has(tool)) {
            result.tools.push(tool);
            addedTools.add(tool);
          }
        });
      }
    }
  }

  return result;
}
