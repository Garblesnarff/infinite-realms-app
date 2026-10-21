/**
 * Rest System Type Definitions
 *
 * Type-safe interfaces for D&D 5E rest mechanics including short rests,
 * long rests, hit dice management, and resource restoration.
 */

/**
 * Rest type discriminator
 */
export type RestType = 'short' | 'long';

/**
 * Rest event representing a completed or interrupted rest
 */
export interface RestEvent {
  id: string;
  characterId: string;
  sessionId: string | null;
  restType: RestType;
  startedAt: Date;
  completedAt: Date | null;
  hpRestored: number | null;
  hitDiceSpent: number | null;
  resourcesRestored: string | null; // JSON string of restored resources
  interrupted: boolean;
  notes: string | null;
}

/**
 * Hit dice for a character's class
 */
export interface HitDice {
  id: string;
  characterId: string;
  className: string;
  dieType: HitDieType;
  totalDice: number;
  usedDice: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of a short rest
 */
export interface ShortRestResult {
  characterId: string;
  restType: 'short';
  hpRestored: number;
  hitDiceSpent: number;
  /** Every die this rest spent, in spend order (#751 follow-up). */
  hitDieRolls: HitDieRoll[];
  hitDiceRemaining: HitDice[];
  resourcesRestored: RestorableResource[];
  spellSlots: Record<string, { max?: number; current?: number }> | null;
  pactSlots: Record<string, unknown> | null;
  classFeatures: unknown;
  restEventId: string;
}

/**
 * Result of a long rest
 */
export interface LongRestResult {
  characterId: string;
  restType: 'long';
  hpRestored: number;
  hitDiceRestored: number;
  hitDiceRemaining: HitDice[];
  resourcesRestored: RestorableResource[];
  spellSlots: Record<string, { max?: number; current?: number }> | null;
  pactSlots: Record<string, unknown> | null;
  classFeatures: unknown;
  restEventId: string;
}

/**
 * A resource that can be restored during rest
 */
export interface RestorableResource {
  resourceType: string; // 'spell_slot', 'class_feature', 'hp', 'hit_dice'
  resourceName: string;
  amountRestored: number | string;
  maxAmount?: number | string;
}

/**
 * Input for taking a short rest
 */
export interface TakeShortRestInput {
  characterId: string;
  hitDiceToSpend?: number;
  sessionId?: string;
  notes?: string;
}

/**
 * Input for taking a long rest
 */
export interface TakeLongRestInput {
  characterId: string;
  sessionId?: string;
  notes?: string;
}

/**
 * Input for spending hit dice
 */
export interface SpendHitDiceInput {
  characterId: string;
  count: number;
  roll?: number; // Optional pre-rolled value for testing
}

/**
 * Result of spending hit dice
 */
export interface SpendHitDiceResult {
  hpRestored: number;
  hitDiceSpent: number;
  rolls: number[];
  hitDiceRemaining: HitDice[];
}

/**
 * One hit die spent on a rest, with the roll the player is entitled to see
 * (#751 follow-up: a story short rest's die roll was silent — the spend
 * happened server-side but no surface ever showed the number).
 */
export interface HitDieRoll {
  dieType: HitDieType;
  roll: number;
  /** HP this die restored: roll + CON modifier, minimum 0 (2014 PHB pg. 186). */
  hpGained: number;
}

/**
 * Hit die type by class name
 */
export type HitDieType = 'd6' | 'd8' | 'd10' | 'd12';

/**
 * Mapping of class names to hit die types
 */
export const HIT_DICE_BY_CLASS: Record<string, HitDieType> = {
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

