import { abilityModifier } from '../../../../shared/ability-modifier';
import { proficiencyBonus } from '../../../../shared/proficiency-bonus';
import { XP_TO_REACH_LEVEL } from '../../../../shared/xp-tables';

/**
 * Progression Mechanics
 *
 * Pure D&D 5E rules for experience points, leveling, and hit dice.
 * Follows PHB rules for progression.
 */

/**
 * D&D 5E XP thresholds by level (PHB pg. 15)
 */
export { XP_TO_REACH_LEVEL as XP_THRESHOLDS };

/**
 * Levels that grant Ability Score Improvement (PHB pg. 12)
 */
export const ASI_LEVEL_LIST = [4, 8, 12, 16, 19];

/**
 * Hit dice by class
 */
export const HIT_DICE_BY_CLASS: Record<string, string> = {
  Barbarian: 'd12',
  Fighter: 'd10',
  Paladin: 'd10',
  Ranger: 'd10',
  Bard: 'd8',
  Cleric: 'd8',
  Druid: 'd8',
  Monk: 'd8',
  Rogue: 'd8',
  Warlock: 'd8',
  Sorcerer: 'd6',
  Wizard: 'd6',
};

export class ProgressionMechanics {
  /**
   * Calculate proficiency bonus for a given level
   * PHB pg. 15: +2 (levels 1-4), +3 (5-8), +4 (9-12), +5 (13-16), +6 (17-20)
   */
  static calculateProficiencyBonus(level: number): number {
    return proficiencyBonus(level);
  }

  /**
   * Get XP threshold for a specific level
   */
  static getXPForLevel(level: number): number {
    if (level < 1) {
      return 0;
    }
    if (level > 20) {
      return XP_TO_REACH_LEVEL[20] ?? 0;
    }
    return XP_TO_REACH_LEVEL[level] ?? 0;
  }

  /**
   * Calculate level from total XP
   */
  static calculateLevelFromXP(totalXp: number): number {
    for (let level = 20; level >= 1; level--) {
      const threshold = XP_TO_REACH_LEVEL[level];
      if (threshold !== undefined && totalXp >= threshold) {
        return level;
      }
    }
    return 1;
  }

  /**
   * Calculate XP needed for next level
   */
  static calculateXPToNextLevel(currentLevel: number, currentXp: number): number {
    if (currentLevel >= 20) {
      return 0;
    }
    const nextLevelXP = this.getXPForLevel(currentLevel + 1);
    return nextLevelXP - currentXp;
  }

  /**
   * Check if a level grants ASI
   */
  static grantsAbilityScoreImprovement(level: number): boolean {
    return ASI_LEVEL_LIST.includes(level);
  }

  /**
   * Calculate Constitution modifier
   */
  static calculateConModifier(constitution: number): number {
    return abilityModifier(constitution);
  }

  /**
   * Get hit die type for a class
   */
  static getHitDieType(className: string): string {
    return HIT_DICE_BY_CLASS[className] || 'd8';
  }

  /**
   * Roll a hit die or use average
   */
  static rollHitDie(dieType: string, useAverage: boolean = false): number {
    const dieSize = parseInt(dieType.substring(1));
    if (useAverage) {
      return Math.floor(dieSize / 2) + 1;
    }
    return Math.floor(Math.random() * dieSize) + 1;
  }

  /**
   * Get the full XP table
   */
  static getXPTable(): Record<number, number> {
    return { ...XP_TO_REACH_LEVEL };
  }
}
