/**
 * Progression Service
 *
 * Implements D&D 5E experience points and leveling system.
 * Follows PHB pg. 15 rules for XP thresholds and level advancement.
 *
 * @module server/services/progression-service
 */

import { eq, and, desc, or, exists, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  experienceEvents,
  levelProgression,
  characters,
} from '../../../db/schema/index';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { LevelUpService } from './progression/level-up-service.js';
import { ProgressionMechanics } from './progression/progression-mechanics.js';

import type { ExperienceEvent, LevelProgression } from '../../../db/schema/index';
import type {
  XPSource,
  AwardXPResult,
  ProgressionStatus,
  LevelUpOptions,
  LevelUpInput,
  LevelUpResult,
} from '../types/progression.js';

/**
 * Progression Service
 */
export class ProgressionService {
  /**
   * Calculate proficiency bonus for a given level
   * PHB pg. 15: +2 (levels 1-4), +3 (5-8), +4 (9-12), +5 (13-16), +6 (17-20)
   */
  static calculateProficiencyBonus(level: number): number {
    return ProgressionMechanics.calculateProficiencyBonus(level);
  }

  /**
   * Get XP threshold for a specific level
   */
  static getXPForLevel(level: number): number {
    return ProgressionMechanics.getXPForLevel(level);
  }

  /**
   * Calculate level from total XP
   */
  static calculateLevelFromXP(totalXp: number): number {
    return ProgressionMechanics.calculateLevelFromXP(totalXp);
  }

  /**
   * Calculate XP needed for next level
   */
  static calculateXPToNextLevel(currentLevel: number, currentXp: number): number {
    return ProgressionMechanics.calculateXPToNextLevel(currentLevel, currentXp);
  }

  /**
   * Check if a level grants ASI
   */
  static grantsAbilityScoreImprovement(level: number): boolean {
    return ProgressionMechanics.grantsAbilityScoreImprovement(level);
  }

  /**
   * Calculate Constitution modifier
   */
  private static calculateConModifier(constitution: number): number {
    return ProgressionMechanics.calculateConModifier(constitution);
  }

  /**
   * Get hit die type for a class
   */
  private static getHitDieType(className: string): string {
    return ProgressionMechanics.getHitDieType(className);
  }

  /**
   * Roll a hit die or use average
   */
  private static rollHitDie(dieType: string, useAverage: boolean = false): number {
    return ProgressionMechanics.rollHitDie(dieType, useAverage);
  }

  /**
   * Initialize progression for a new character
   */
  static async initializeProgression(characterId: string, userId: string): Promise<LevelProgression> {
    // Check if progression already exists
    const existing = await db.query.levelProgression.findFirst({
      where: and(
        eq(levelProgression.characterId, characterId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ),
    });

    if (existing) {
      return existing;
    }

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    // This ensures that progression can only be initialized for characters the user is authorized to access.
    const [progression] = await db
      .insert(levelProgression)
      .select(
        db.select({
          characterId: sql`${characterId}`,
          currentLevel: sql`1`,
          currentXp: sql`0`,
          xpToNextLevel: sql`${ProgressionMechanics.getXPForLevel(2) || 300}`,
          totalXp: sql`0`,
        })
        .from(characters)
        .where(and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ))
      )
      .returning();

    if (!progression) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character', characterId);
    }

    return progression;
  }

  /**
   * Get current progression for a character
   */
  static async getProgression(characterId: string, userId: string): Promise<ProgressionStatus> {
    const results = await db
      .select({ progression: levelProgression })
      .from(levelProgression)
      .innerJoin(characters, eq(levelProgression.characterId, characters.id))
      .where(and(
        eq(levelProgression.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    let progression = results[0]?.progression;

    // Initialize if doesn't exist
    if (!progression) {
      progression = await this.initializeProgression(characterId, userId);
    }

    const percentToNext = progression.currentLevel >= 20
      ? 100
      : (progression.currentXp / (progression.currentXp + progression.xpToNextLevel)) * 100;

    return {
      level: progression.currentLevel,
      xp: progression.currentXp,
      xpToNext: progression.xpToNextLevel,
      totalXp: progression.totalXp,
      percentToNext: Math.round(percentToNext * 100) / 100,
      proficiencyBonus: this.calculateProficiencyBonus(progression.currentLevel),
    };
  }

  /**
   * Check if character can level up
   */
  static async canLevelUp(characterId: string, userId: string): Promise<boolean> {
    const results = await db
      .select({ progression: levelProgression })
      .from(levelProgression)
      .innerJoin(characters, eq(levelProgression.characterId, characters.id))
      .where(and(
        eq(levelProgression.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    const progression = results[0]?.progression;

    if (!progression) return false;
    if (progression.currentLevel >= 20) return false;

    return progression.xpToNextLevel <= 0;
  }

  /**
   * Award XP to a character
   * Returns info about level-ups if they occurred
   */
  static async awardXP(
    characterId: string,
    xp: number,
    source: XPSource,
    userId: string,
    description?: string,
    sessionId?: string
  ): Promise<AwardXPResult> {
    if (xp < 0) {
      throw new ValidationError('Cannot award negative XP', { xp });
    }

    // Get or create progression
    const results = await db
      .select({ progression: levelProgression })
      .from(levelProgression)
      .innerJoin(characters, eq(levelProgression.characterId, characters.id))
      .where(and(
        eq(levelProgression.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    let progression = results[0]?.progression;

    if (!progression) {
      progression = await this.initializeProgression(characterId, userId);
    }

    const oldLevel = progression.currentLevel;
    const newTotalXp = progression.totalXp + xp;
    const newLevel = this.calculateLevelFromXP(newTotalXp);
    const levelsGained = newLevel - oldLevel;

    // ⚡ Bolt: Parallelize database updates to reduce round-trip latency.
    // Progression update, character level update, and event logging are independent operations.
    const progressionUpdate = db
      .update(levelProgression)
      .set({
        currentLevel: newLevel,
        currentXp: newTotalXp,
        totalXp: newTotalXp,
        xpToNextLevel: this.calculateXPToNextLevel(newLevel, newTotalXp),
        lastLevelUp: levelsGained > 0 ? new Date() : progression.lastLevelUp,
        updatedAt: new Date(),
      })
      .where(and(
        eq(levelProgression.characterId, characterId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ))
      .returning();

    const charUpdate = levelsGained > 0
      ? db
          .update(characters)
          .set({
            level: newLevel,
            updatedAt: new Date(),
          })
          .where(and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
      : Promise.resolve();

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const eventLog = db.insert(experienceEvents).select(
      db.select({
        characterId: sql`${characterId}`,
        sessionId: sql`${sessionId || null}`,
        xpGained: sql`${xp}`,
        source: sql`${source}`,
        description: sql`${description || null}`,
      })
      .from(characters)
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
    );

    const [updatedRows] = await Promise.all([progressionUpdate, charUpdate, eventLog]);
    const updatedProgression = (updatedRows as LevelProgression[])[0];

    if (!updatedProgression) {
      throw new Error('Failed to update progression');
    }

    return {
      newXp: updatedProgression.currentXp,
      totalXp: updatedProgression.totalXp,
      leveledUp: levelsGained > 0,
      oldLevel,
      newLevel,
      levelsGained,
    };
  }

  /**
   * Get XP history for a character
   */
  static async getXPHistory(
    characterId: string,
    userId: string,
    sessionId?: string,
    limit: number = 50
  ): Promise<ExperienceEvent[]> {
    const history = await db
      .select({ event: experienceEvents })
      .from(experienceEvents)
      .innerJoin(characters, eq(experienceEvents.characterId, characters.id))
      .where(and(
        eq(experienceEvents.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        sessionId ? eq(experienceEvents.sessionId, sessionId) : undefined
      ))
      .orderBy(desc(experienceEvents.timestamp))
      .limit(limit);

    return history.map(h => h.event);
  }

  /**
   * Get level-up options for a character at a new level
   */
  static async getLevelUpOptions(
    characterId: string,
    newLevel: number,
    userId: string
  ): Promise<LevelUpOptions> {
    return LevelUpService.getLevelUpOptions(characterId, newLevel, userId);
  }

  /**
   * Perform a level-up for a character
   */
  static async levelUp(input: LevelUpInput, userId: string): Promise<LevelUpResult> {
    return LevelUpService.levelUp(input, userId);
  }

  /**
   * Set character level directly (milestone leveling)
   */
  static async setLevel(
    characterId: string,
    level: number,
    userId: string,
    reason?: string
  ): Promise<{ oldLevel: number; newLevel: number }> {
    return LevelUpService.setLevel(characterId, level, userId, reason);
  }

  /**
   * Get XP table
   */
  static getXPTable(): Record<number, number> {
    return ProgressionMechanics.getXPTable();
  }
}
