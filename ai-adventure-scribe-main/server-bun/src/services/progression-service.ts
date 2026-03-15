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
  characterStats,
} from '../../../db/schema/index';
import { NotFoundError, ValidationError, BusinessLogicError } from '../lib/errors.js';
import { ProgressionMechanics } from './progression/progression-mechanics.js';

import type { ExperienceEvent, LevelProgression } from '../../../db/schema/index';
import type {
  XPSource,
  AwardXPResult,
  ProgressionStatus,
  LevelUpOptions,
  LevelUpInput,
  LevelUpResult,
  HitPointIncrease,
  ClassFeature,
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
    const updatedProgression = (updatedRows as any)[0];

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
    // Get character
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
      with: {
        stats: true,
      },
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    if (!character.stats) {
      throw new BusinessLogicError('Character has no stats', { characterId });
    }

    const className = character.class || 'Fighter';
    const dieType = this.getHitDieType(className);
    const dieSize = parseInt(dieType.substring(1));
    const conModifier = this.calculateConModifier(character.stats.constitution);
    const averageRoll = Math.floor(dieSize / 2) + 1;

    const hasASI = this.grantsAbilityScoreImprovement(newLevel);

    // Placeholder class features (would be expanded with full class data)
    const classFeatures: ClassFeature[] = [];
    if (newLevel === 2) {
      classFeatures.push({
        name: 'Class Feature (Level 2)',
        level: 2,
        description: 'Gain your level 2 class feature',
      });
    }

    return {
      newLevel,
      hpIncrease: {
        dieType,
        conModifier,
        averageRoll,
      },
      hasAbilityScoreImprovement: hasASI,
      abilityScoreOptions: hasASI ? {
        maxIncrease: 2,
        canTakeFeat: true,
      } : undefined,
      classFeatures,
      proficiencyBonus: this.calculateProficiencyBonus(newLevel),
    };
  }

  /**
   * Perform a level-up for a character
   */
  static async levelUp(input: LevelUpInput, userId: string): Promise<LevelUpResult> {
    const { characterId, hpRoll, abilityScoreImprovements, featSelected, spellsLearned } = input;

    // Get character
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
      with: {
        stats: true,
      },
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    if (!character.stats) {
      throw new BusinessLogicError('Character has no stats', { characterId });
    }

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

    if (!progression) {
      throw new NotFoundError('Progression for character', characterId);
    }

    const oldLevel = progression.currentLevel;
    const newLevel = oldLevel + 1;

    if (newLevel > 20) {
      throw new BusinessLogicError('Character is already at maximum level (20)', {
        characterId,
        currentLevel: oldLevel,
      });
    }

    // Calculate HP increase
    const className = character.class || 'Fighter';
    const dieType = this.getHitDieType(className);
    const conModifier = this.calculateConModifier(character.stats.constitution);
    const roll = hpRoll || this.rollHitDie(dieType, true);
    const hpGained = Math.max(1, roll + conModifier);

    const hpIncrease: HitPointIncrease = {
      roll,
      conModifier,
      totalGained: hpGained,
    };

    // Apply ability score improvements
    const updatedStats = { ...character.stats };
    if (abilityScoreImprovements && abilityScoreImprovements.length > 0) {
      const totalIncrease = abilityScoreImprovements.reduce((sum, asi) => sum + asi.increase, 0);
      if (totalIncrease > 2) {
        throw new ValidationError('Total ability score increase cannot exceed +2', {
          totalIncrease,
          abilityScoreImprovements,
        });
      }

      for (const asi of abilityScoreImprovements) {
        const currentValue = updatedStats[asi.ability];
        const newValue = Math.min(20, currentValue + asi.increase);
        updatedStats[asi.ability] = newValue;
      }

      // Update stats in database
      const statsUpdate = db
        .update(characterStats)
        .set({
          strength: updatedStats.strength,
          dexterity: updatedStats.dexterity,
          constitution: updatedStats.constitution,
          intelligence: updatedStats.intelligence,
          wisdom: updatedStats.wisdom,
          charisma: updatedStats.charisma,
          updatedAt: new Date(),
        })
        .where(and(
          eq(characterStats.id, character.stats.id),
          eq(characterStats.characterId, characterId),
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          )
        ));

      // ⚡ Bolt: Parallelize all database updates for character level-up.
      // Stats, character record, and level progression are independent updates.
      const newTotalXp = this.getXPForLevel(newLevel);
      const charUpdate = db
        .update(characters)
        .set({
          level: newLevel,
          experiencePoints: newTotalXp,
          updatedAt: new Date(),
        })
        .where(and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ));

      const progressionUpdate = db
        .update(levelProgression)
        .set({
          currentLevel: newLevel,
          currentXp: newTotalXp,
          totalXp: newTotalXp,
          xpToNextLevel: this.calculateXPToNextLevel(newLevel, newTotalXp),
          lastLevelUp: new Date(),
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
        ));

      await Promise.all([statsUpdate, charUpdate, progressionUpdate]);
    } else {
      // ⚡ Bolt: Parallelize level and progression updates when no ASI is required.
      const newTotalXp = this.getXPForLevel(newLevel);
      const charUpdate = db
        .update(characters)
        .set({
          level: newLevel,
          experiencePoints: newTotalXp,
          updatedAt: new Date(),
        })
        .where(and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ));

      const progressionUpdate = db
        .update(levelProgression)
        .set({
          currentLevel: newLevel,
          currentXp: newTotalXp,
          totalXp: newTotalXp,
          xpToNextLevel: this.calculateXPToNextLevel(newLevel, newTotalXp),
          lastLevelUp: new Date(),
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
        ));

      await Promise.all([charUpdate, progressionUpdate]);
    }

    // Get class features for this level (placeholder)
    const newClassFeatures: ClassFeature[] = [];
    if (this.grantsAbilityScoreImprovement(newLevel)) {
      newClassFeatures.push({
        name: 'Ability Score Improvement',
        level: newLevel,
        description: 'Increase one ability score by 2, or two ability scores by 1 each',
      });
    }

    return {
      characterId,
      oldLevel,
      newLevel,
      hpIncrease,
      abilityScoreImprovements,
      featSelected,
      newClassFeatures,
      newSpells: spellsLearned,
      proficiencyBonus: this.calculateProficiencyBonus(newLevel),
      timestamp: new Date(),
    };
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
    if (level < 1 || level > 20) {
      throw new ValidationError('Level must be between 1 and 20', { level });
    }

    // Get current progression
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
    const newTotalXp = this.getXPForLevel(level);

    // ⚡ Bolt: Parallelize independent database updates for milestone leveling.
    // Progression update, character level update, and event logging are independent operations.
    // 🛡️ Sentinel: Added .returning() and check for updated rows to prevent unauthorized access success.
    const progressionUpdate = db
      .update(levelProgression)
      .set({
        currentLevel: level,
        currentXp: newTotalXp,
        totalXp: newTotalXp,
        xpToNextLevel: this.calculateXPToNextLevel(level, newTotalXp),
        lastLevelUp: new Date(),
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

    const charUpdate = db
      .update(characters)
      .set({
        level,
        experiencePoints: newTotalXp,
        updatedAt: new Date(),
      })
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .returning();

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const eventLog = db.insert(experienceEvents).select(
      db.select({
        characterId: sql`${characterId}`,
        sessionId: sql`NULL`,
        xpGained: sql`0`,
        source: sql`'milestone'`,
        description: sql`${reason || `Milestone level set to ${level}`}`,
      })
      .from(characters)
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
    );

    const [progRows] = await Promise.all([progressionUpdate, charUpdate, eventLog]);

    if (!progRows || progRows.length === 0) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character progression', characterId);
    }

    return { oldLevel, newLevel: level };
  }

  /**
   * Get XP table
   */
  static getXPTable(): Record<number, number> {
    return ProgressionMechanics.getXPTable();
  }
}
