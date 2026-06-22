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

import { and, eq, exists, or, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  campaigns,
  characters,
  combatParticipants,
  combatParticipantStatus,
  npcs,
} from '../../../db/schema/index';
import { NotFoundError, BusinessLogicError } from '../lib/errors.js';
import {
  type ExhaustionLevel,
  type ExhaustionEffects,
  type ExhaustionResult,
  type ExhaustionCause,
  getExhaustionEffects,
  getExhaustionModifiers,
  calculateEffectiveMaxHp,
  calculateEffectiveSpeed,
  getExhaustionDescription,
  getExhaustionScenarios,
} from './exhaustion/exhaustion-mechanics';

export { type ExhaustionLevel, type ExhaustionEffects, type ExhaustionResult, type ExhaustionCause };

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
   * Get the mechanical effects for a given exhaustion level (Delegated)
   */
  static getExhaustionEffects(level: ExhaustionLevel): ExhaustionEffects {
    return getExhaustionEffects(level);
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

    const effects = getExhaustionEffects(newLevel);
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
   * Check if exhaustion affects a specific action type (Delegated)
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
    return getExhaustionModifiers(level);
  }

  /**
   * Calculate effective HP maximum considering exhaustion (Delegated)
   *
   * @param baseMaxHp - The character's normal maximum HP
   * @param exhaustionLevel - Current exhaustion level
   */
  static calculateEffectiveMaxHp(baseMaxHp: number, exhaustionLevel: ExhaustionLevel): number {
    return calculateEffectiveMaxHp(baseMaxHp, exhaustionLevel);
  }

  /**
   * Calculate effective speed considering exhaustion (Delegated)
   *
   * @param baseSpeed - The character's normal speed
   * @param exhaustionLevel - Current exhaustion level
   */
  static calculateEffectiveSpeed(baseSpeed: number, exhaustionLevel: ExhaustionLevel): number {
    return calculateEffectiveSpeed(baseSpeed, exhaustionLevel);
  }

  /**
   * Get a description of all exhaustion effects for display (Delegated)
   */
  static getExhaustionDescription(level: ExhaustionLevel): string {
    return getExhaustionDescription(level);
  }

  /**
   * Common exhaustion scenarios (Delegated)
   */
  static getExhaustionScenarios(): Record<
    ExhaustionCause,
    { levels: number; description: string }
  > {
    return getExhaustionScenarios();
  }
}

// Export singleton-style access (class has all static methods)
export const exhaustionService = ExhaustionService;
