/**
 * Exhaustion Mechanics
 *
 * Pure logic and data for the D&D 5E exhaustion system.
 * Extracted from ExhaustionService to improve maintainability.
 *
 * @module server/services/exhaustion/exhaustion-mechanics
 */

/**
 * Exhaustion level (0-6)
 * 0 = no exhaustion
 * 6 = death
 */
export type ExhaustionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Exhaustion effects at each level (cumulative)
 */
export interface ExhaustionEffects {
  level: ExhaustionLevel;
  /**
   * Level 1+: Disadvantage on ability checks
   */
  disadvantageOnAbilityChecks: boolean;
  /**
   * Level 2+: Speed multiplier (0.5 = halved)
   */
  speedMultiplier: number;
  /**
   * Level 3+: Disadvantage on attack rolls
   */
  disadvantageOnAttacks: boolean;
  /**
   * Level 3+: Disadvantage on saving throws
   */
  disadvantageOnSaves: boolean;
  /**
   * Level 4+: HP maximum multiplier (0.5 = halved)
   */
  hpMaxMultiplier: number;
  /**
   * Level 5+: Speed reduced to 0
   */
  speedZero: boolean;
  /**
   * Level 6: Death
   */
  isDead: boolean;
  /**
   * Human-readable description of effects
   */
  description: string[];
}

/**
 * Result of applying or reducing exhaustion
 */
export interface ExhaustionResult {
  participantId: string;
  previousLevel: ExhaustionLevel;
  newLevel: ExhaustionLevel;
  effects: ExhaustionEffects;
  levelChanged: boolean;
  message: string;
}

/**
 * Common causes of exhaustion in D&D 5E
 */
export type ExhaustionCause =
  | 'forced_march'
  | 'starvation'
  | 'dehydration'
  | 'extreme_cold'
  | 'extreme_heat'
  | 'berserker_frenzy'
  | 'sickening_radiance'
  | 'long_rest_without_food'
  | 'other';

/**
 * Get the mechanical effects for a given exhaustion level
 * Effects are cumulative - higher levels include all lower level effects
 */
export function getExhaustionEffects(level: ExhaustionLevel): ExhaustionEffects {
  const description: string[] = [];

  // Level 1+: Disadvantage on ability checks
  const disadvantageOnAbilityChecks = level >= 1;
  if (disadvantageOnAbilityChecks) {
    description.push('Disadvantage on ability checks');
  }

  // Level 2+: Speed halved
  let speedMultiplier = 1;
  if (level >= 2 && level < 5) {
    speedMultiplier = 0.5;
    description.push('Speed halved');
  }

  // Level 3+: Disadvantage on attacks and saves
  const disadvantageOnAttacks = level >= 3;
  const disadvantageOnSaves = level >= 3;
  if (level >= 3) {
    description.push('Disadvantage on attack rolls and saving throws');
  }

  // Level 4+: HP max halved
  const hpMaxMultiplier = level >= 4 ? 0.5 : 1;
  if (level >= 4) {
    description.push('Hit point maximum halved');
  }

  // Level 5+: Speed = 0
  const speedZero = level >= 5;
  if (speedZero) {
    // Override speed multiplier
    speedMultiplier = 0;
    description.push('Speed reduced to 0');
  }

  // Level 6: Death
  const isDead = level >= 6;
  if (isDead) {
    description.push('DEATH');
  }

  return {
    level,
    disadvantageOnAbilityChecks,
    speedMultiplier,
    disadvantageOnAttacks,
    disadvantageOnSaves,
    hpMaxMultiplier,
    speedZero,
    isDead,
    description,
  };
}

/**
 * Check if exhaustion affects a specific action type
 */
export function getExhaustionModifiers(level: ExhaustionLevel): {
  abilityCheckDisadvantage: boolean;
  attackDisadvantage: boolean;
  saveDisadvantage: boolean;
  speedModifier: number;
  hpMaxModifier: number;
  cannotMove: boolean;
  isDead: boolean;
} {
  const effects = getExhaustionEffects(level);

  return {
    abilityCheckDisadvantage: effects.disadvantageOnAbilityChecks,
    attackDisadvantage: effects.disadvantageOnAttacks,
    saveDisadvantage: effects.disadvantageOnSaves,
    speedModifier: effects.speedMultiplier,
    hpMaxModifier: effects.hpMaxMultiplier,
    cannotMove: effects.speedZero,
    isDead: effects.isDead,
  };
}

/**
 * Calculate effective HP maximum considering exhaustion
 *
 * @param baseMaxHp - The character's normal maximum HP
 * @param exhaustionLevel - Current exhaustion level
 */
export function calculateEffectiveMaxHp(baseMaxHp: number, exhaustionLevel: ExhaustionLevel): number {
  const effects = getExhaustionEffects(exhaustionLevel);
  return Math.floor(baseMaxHp * effects.hpMaxMultiplier);
}

/**
 * Calculate effective speed considering exhaustion
 *
 * @param baseSpeed - The character's normal speed
 * @param exhaustionLevel - Current exhaustion level
 */
export function calculateEffectiveSpeed(baseSpeed: number, exhaustionLevel: ExhaustionLevel): number {
  const effects = getExhaustionEffects(exhaustionLevel);
  if (effects.speedZero) {
    return 0;
  }
  return Math.floor(baseSpeed * effects.speedMultiplier);
}

/**
 * Get a description of all exhaustion effects for display
 */
export function getExhaustionDescription(level: ExhaustionLevel): string {
  if (level === 0) {
    return 'No exhaustion';
  }

  const effects = getExhaustionEffects(level);
  return `Exhaustion Level ${level}: ${effects.description.join(', ')}`;
}

/**
 * Common exhaustion scenarios
 */
export function getExhaustionScenarios(): Record<
  ExhaustionCause,
  { levels: number; description: string }
> {
  return {
    forced_march: {
      levels: 1,
      description:
        'Each hour of travel beyond 8 hours requires a DC 10 + hours beyond 8 CON save or gain 1 level',
    },
    starvation: {
      levels: 1,
      description:
        'Going without food for days equal to 3 + CON modifier causes 1 level per day thereafter',
    },
    dehydration: {
      levels: 1,
      description:
        'Going without water for 1 day (or half day in hot weather) causes 1 level per day/half-day',
    },
    extreme_cold: {
      levels: 1,
      description: 'Failing a DC 10 CON save after each hour in extreme cold causes 1 level',
    },
    extreme_heat: {
      levels: 1,
      description: 'Failing a CON save (DC 5 + 1 per hour) in extreme heat causes 1 level',
    },
    berserker_frenzy: {
      levels: 1,
      description: 'When Berserker rage ends, gain 1 level of exhaustion',
    },
    sickening_radiance: {
      levels: 1,
      description: 'Failing a CON save against Sickening Radiance causes 1 level',
    },
    long_rest_without_food: {
      levels: 0,
      description: 'Long rest without food does not reduce exhaustion',
    },
    other: {
      levels: 1,
      description: 'Other source of exhaustion',
    },
  };
}
