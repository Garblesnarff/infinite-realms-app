/* eslint-disable max-lines */
/**
 * Exhaustion Service
 *
 * Handles D&D 5E exhaustion system with 6 cumulative levels.
 * Per PHB p.291, effects are cumulative:
 *
 * Level 1: Disadvantage on ability checks
 * Level 2: Speed halved
 * Level 3: Disadvantage on attack rolls and saving throws
 * Level 4: Hit point maximum halved
 * Level 5: Speed reduced to 0
 * Level 6: Death
 *
 * @module server/services/exhaustion-service
 */

import { and, eq, exists, or } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  campaigns,
  characters,
  combatParticipants,
  combatParticipantStatus,
  npcs,
} from '../../../db/schema/index.js';
import { NotFoundError, BusinessLogicError } from '../lib/errors.js';

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

export class ExhaustionService {
  /**
   * Verify participant access via encounter/session ownership.
   * Throws NOT_FOUND for missing or unauthorized participants.
   */
  private static async verifyParticipantAccess(participantId: string, userId: string): Promise<void> {
    const result = await db.execute<Record<string, unknown>>(
      sql`
        SELECT cp.id
        FROM combat_participants cp
        JOIN combat_encounters ce ON ce.id = cp.encounter_id
        JOIN game_sessions gs ON gs.id = ce.session_id
        LEFT JOIN campaigns camp ON camp.id = gs.campaign_id
        LEFT JOIN characters char ON char.id = gs.character_id
        WHERE cp.id = ${participantId}
          AND (camp.user_id = ${userId} OR char.user_id = ${userId} OR char.owner_id = ${userId})
        LIMIT 1
      `
    );

    if (!result || result.length === 0) {
      throw new NotFoundError('Participant', participantId);
    }
  }

  /**
   * Get the mechanical effects for a given exhaustion level
   * Effects are cumulative - higher levels include all lower level effects
   */
  static getExhaustionEffects(level: ExhaustionLevel): ExhaustionEffects {
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
   * Get current exhaustion level for a participant
   * @param participantId - The participant ID
   * @param userId - User ID for ownership verification
   */
  static async getExhaustionLevel(participantId: string, userId: string): Promise<ExhaustionLevel> {
    // 🛡️ Sentinel: Verify ownership of the participant while fetching their status.
    // This distinguishes between "no access" (throws 404) and "no record" (returns 0).
    const participant = await db.query.combatParticipants.findFirst({
      where: and(
        eq(combatParticipants.id, participantId),
        or(
          // Access via owned character
          exists(
            db
              .select()
              .from(characters)
              .where(
                and(
                  eq(characters.id, combatParticipants.characterId),
                  or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                ),
              ),
          ),
          // Access via owned campaign (NPCs)
          exists(
            db
              .select()
              .from(npcs)
              .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
              .where(and(eq(npcs.id, combatParticipants.npcId), eq(campaigns.userId, userId))),
          ),
        ),
      ),
      with: {
        status: true,
      },
    });

    if (!participant) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Participant', participantId);
    }

    const level = participant.status?.exhaustionLevel || 0;
    return Math.min(6, Math.max(0, level)) as ExhaustionLevel;
  }

  /**
   * Apply exhaustion levels to a participant
   *
   * @param participantId - The participant to affect
   * @param levels - Number of levels to add (positive) or remove (negative)
   * @param userId - User ID for ownership verification
   * @param cause - Optional cause for logging
   */
  static async applyExhaustion(
    participantId: string,
    levels: number,
    userId: string,
    cause?: ExhaustionCause,
  ): Promise<ExhaustionResult> {
    // Get current level (verified for ownership)
    const previousLevel = await this.getExhaustionLevel(participantId, userId);

    // Calculate new level (clamped 0-6)
    const newLevel = Math.min(6, Math.max(0, previousLevel + levels)) as ExhaustionLevel;

    // Update database
    // 🛡️ Sentinel: Re-verify ownership during update for defense in depth.
    await db
      .update(combatParticipantStatus)
      .set({
        exhaustionLevel: newLevel,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(combatParticipantStatus.participantId, participantId),
          exists(
            db
              .select()
              .from(combatParticipants)
              .where(
                and(
                  eq(combatParticipants.id, participantId),
                  or(
                    // Access via owned character
                    exists(
                      db
                        .select()
                        .from(characters)
                        .where(
                          and(
                            eq(characters.id, combatParticipants.characterId),
                            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                          ),
                        ),
                    ),
                    // Access via owned campaign (NPCs)
                    exists(
                      db
                        .select()
                        .from(npcs)
                        .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
                        .where(
                          and(eq(npcs.id, combatParticipants.npcId), eq(campaigns.userId, userId)),
                        ),
                    ),
                  ),
                ),
              ),
          ),
        ),
      );

    const effects = this.getExhaustionEffects(newLevel);
    const levelChanged = previousLevel !== newLevel;

    // Generate message
    let message: string;
    if (levels > 0) {
      message = `Gained ${levels} level(s) of exhaustion (${previousLevel} → ${newLevel})`;
      if (cause) {
        message += ` from ${cause.replace(/_/g, ' ')}`;
      }
    } else if (levels < 0) {
      message = `Recovered ${Math.abs(levels)} level(s) of exhaustion (${previousLevel} → ${newLevel})`;
    } else {
      message = `Exhaustion level unchanged at ${newLevel}`;
    }

    if (effects.isDead) {
      message += '. Character has died from exhaustion!';
    }

    return {
      participantId,
      previousLevel,
      newLevel,
      effects,
      levelChanged,
      message,
    };
  }

  /**
   * Reduce exhaustion (typically from long rest)
   *
   * D&D 5E: Finishing a long rest reduces exhaustion by 1 level,
   * provided the creature has also ingested some food and drink.
   */
  static async reduceExhaustion(
    participantId: string,
    userId: string,
    levels: number = 1,
    hasFood: boolean = true,
  ): Promise<ExhaustionResult> {
    if (!hasFood) {
      throw new BusinessLogicError('Cannot reduce exhaustion without food and drink', {
        participantId,
      });
    }

    return this.applyExhaustion(participantId, -Math.abs(levels), userId);
  }

  /**
   * Set exhaustion to a specific level
   */
  static async setExhaustionLevel(
    participantId: string,
    level: ExhaustionLevel,
    userId: string,
  ): Promise<ExhaustionResult> {
    const previousLevel = await this.getExhaustionLevel(participantId, userId);
    const difference = level - previousLevel;

    return this.applyExhaustion(participantId, difference, userId);
  }

  /**
   * Check if exhaustion affects a specific action type
   */
  static getExhaustionModifiers(level: ExhaustionLevel): {
    abilityCheckDisadvantage: boolean;
    attackDisadvantage: boolean;
    saveDisadvantage: boolean;
    speedModifier: number;
    hpMaxModifier: number;
    cannotMove: boolean;
    isDead: boolean;
  } {
    const effects = this.getExhaustionEffects(level);

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
  static calculateEffectiveMaxHp(baseMaxHp: number, exhaustionLevel: ExhaustionLevel): number {
    const effects = this.getExhaustionEffects(exhaustionLevel);
    return Math.floor(baseMaxHp * effects.hpMaxMultiplier);
  }

  /**
   * Calculate effective speed considering exhaustion
   *
   * @param baseSpeed - The character's normal speed
   * @param exhaustionLevel - Current exhaustion level
   */
  static calculateEffectiveSpeed(baseSpeed: number, exhaustionLevel: ExhaustionLevel): number {
    const effects = this.getExhaustionEffects(exhaustionLevel);
    if (effects.speedZero) {
      return 0;
    }
    return Math.floor(baseSpeed * effects.speedMultiplier);
  }

  /**
   * Get a description of all exhaustion effects for display
   */
  static getExhaustionDescription(level: ExhaustionLevel): string {
    if (level === 0) {
      return 'No exhaustion';
    }

    const effects = this.getExhaustionEffects(level);
    return `Exhaustion Level ${level}: ${effects.description.join(', ')}`;
  }

  /**
   * Common exhaustion scenarios
   */
  static getExhaustionScenarios(): Record<
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
}

// Export singleton-style access (class has all static methods)
export const exhaustionService = ExhaustionService;
