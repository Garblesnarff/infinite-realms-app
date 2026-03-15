/**
 * Progression Mechanics
 *
 * Pure D&D 5E rules for experience points, leveling, and hit dice.
 * Follows PHB rules for progression.
 */

/**
 * D&D 5E XP thresholds by level (PHB pg. 15)
 */
export const XP_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
  6: 14000,
  7: 23000,
  8: 34000,
  9: 48000,
  10: 64000,
  11: 85000,
  12: 100000,
  13: 120000,
  14: 140000,
  15: 165000,
  16: 195000,
  17: 225000,
  18: 265000,
  19: 305000,
  20: 355000,
};

/**
 * Proficiency bonus by level (PHB pg. 15)
 */
export const PROFICIENCY_BONUSES: Record<number, number> = {
  1: 2, 2: 2, 3: 2, 4: 2,
  5: 3, 6: 3, 7: 3, 8: 3,
  9: 4, 10: 4, 11: 4, 12: 4,
  13: 5, 14: 5, 15: 5, 16: 5,
  17: 6, 18: 6, 19: 6, 20: 6,
};

/**
 * Levels that grant Ability Score Improvement (PHB pg. 12)
 */
export const ASI_LEVEL_LIST = [4, 8, 12, 16, 19];

/**
 * Hit dice by class
 */
export const HIT_DICE_BY_CLASS: Record<string, string> = {
  'Barbarian': 'd12',
  'Fighter': 'd10',
  'Paladin': 'd10',
  'Ranger': 'd10',
  'Bard': 'd8',
  'Cleric': 'd8',
  'Druid': 'd8',
  'Monk': 'd8',
  'Rogue': 'd8',
  'Warlock': 'd8',
  'Sorcerer': 'd6',
  'Wizard': 'd6',
};

export class ProgressionMechanics {
  /**
   * Calculate proficiency bonus for a given level
   * PHB pg. 15: +2 (levels 1-4), +3 (5-8), +4 (9-12), +5 (13-16), +6 (17-20)
   */
  static calculateProficiencyBonus(level: number): number {
    if (level < 1) {
      return 2;
    }
    if (level > 20) {
      return 6;
    }
    return PROFICIENCY_BONUSES[level] || 2;
  }

  /**
   * Get XP threshold for a specific level
   */
  static getXPForLevel(level: number): number {
    if (level < 1) {
      return 0;
    }
    if (level > 20) {
      return XP_THRESHOLDS[20] ?? 0;
    }
    return XP_THRESHOLDS[level] ?? 0;
  }

  /**
   * Calculate level from total XP
   */
  static calculateLevelFromXP(totalXp: number): number {
    for (let level = 20; level >= 1; level--) {
      const threshold = XP_THRESHOLDS[level];
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
    return Math.floor((constitution - 10) / 2);
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
    return { ...XP_THRESHOLDS };
  }
}
