/**
 * Progression System Type Definitions
 *
 * Type-safe interfaces for D&D 5E experience points, leveling system,
 * ability score improvements, and character progression tracking.
 */

/**
 * XP source discriminator
 */
export type XPSource = 'combat' | 'quest' | 'roleplay' | 'milestone' | 'other';

/**
 * Experience event representing an XP award
 */
export interface ExperienceEvent {
  id: string;
  characterId: string;
  sessionId: string | null;
  xpGained: number;
  source: XPSource;
  description: string | null;
  timestamp: Date;
}

/**
 * Level progression state for a character
 */
export interface LevelProgression {
  characterId: string;
  currentLevel: number;
  currentXp: number;
  xpToNextLevel: number;
  totalXp: number;
  lastLevelUp: Date | null;
  updatedAt: Date;
}

/**
 * Result of awarding XP
 */
export interface AwardXPResult {
  newXp: number;
  totalXp: number;
  leveledUp: boolean;
  oldLevel: number;
  newLevel: number;
  levelsGained: number;
}

/**
 * Current progression status
 */
export interface ProgressionStatus {
  level: number;
  xp: number;
  xpToNext: number;
  totalXp: number;
  percentToNext: number;
  proficiencyBonus: number;
}

/**
 * Ability score improvement selection
 */
export interface AbilityScoreImprovement {
  ability: 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
  increase: number; // +1 or +2
}

/**
 * Hit point increase on level-up
 */
export interface HitPointIncrease {
  roll: number;
  conModifier: number;
  totalGained: number;
}

/**
 * Class feature granted at a specific level
 */
export interface ClassFeature {
  name: string;
  level: number;
  description: string;
}

/**
 * Spell learning choice for spellcasters
 */
export interface SpellChoice {
  spellLevel: number;
  spellsKnown: number;
  cantripsKnown?: number;
}

/**
 * Options available when leveling up
 */
export interface LevelUpOptions {
  newLevel: number;
  hpIncrease: {
    dieType: string;
    conModifier: number;
    averageRoll: number;
  };
  hasAbilityScoreImprovement: boolean;
  abilityScoreOptions?: {
    maxIncrease: number; // Total +2 to distribute
    canTakeFeat: boolean;
  };
  classFeatures: ClassFeature[];
  spellChoices?: SpellChoice;
  proficiencyBonus: number;
}

/**
 * Input for performing a level-up
 */
export interface LevelUpInput {
  characterId: string;
  hpRoll?: number; // If not provided, uses average
  abilityScoreImprovements?: AbilityScoreImprovement[];
  featSelected?: string;
  classFeatures?: string[];
  spellsLearned?: string[];
}

/**
 * Result of a level-up
 */
export interface LevelUpResult {
  characterId: string;
  oldLevel: number;
  newLevel: number;
  hpIncrease: HitPointIncrease;
  abilityScoreImprovements?: AbilityScoreImprovement[];
  featSelected?: string;
  newClassFeatures: ClassFeature[];
  newSpells?: string[];
  proficiencyBonus: number;
  timestamp: Date;
}

/**
 * Input for awarding XP
 */
export interface AwardXPInput {
  characterId: string;
  xp: number;
  source: XPSource;
  description?: string;
  sessionId?: string;
}

/**
 * Input for milestone leveling
 */
export interface MilestoneLevelInput {
  characterId: string;
  level: number;
  reason?: string;
}

/**
 * XP history query parameters
 */
export interface XPHistoryQuery {
  characterId: string;
  sessionId?: string;
  limit?: number;
}

/**
 * D&D 5E XP thresholds by level (PHB pg. 15)
 */
export { XP_TO_REACH_LEVEL as XP_TABLE } from '../../../shared/xp-tables';

/**
 * Levels that grant Ability Score Improvement (PHB pg. 12)
 */
export const ASI_LEVELS = [4, 8, 12, 16, 19];

/**
 * Maximum ability score without magical enhancement
 */
export const MAX_ABILITY_SCORE = 20;

/**
 * Maximum character level
 */
export const MAX_LEVEL = 20;
