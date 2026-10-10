/**
 * Level Up Service
 *
 * Handles character level-up logic, including HP increases,
 * Ability Score Improvements (ASI), and milestone leveling.
 *
 * @module server/services/progression/level-up-service
 */

import { eq, and, or, exists } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  experienceEvents,
  levelProgression,
  characters,
  characterStats,
} from '../../../../db/schema/index';
import { NotFoundError, ValidationError, BusinessLogicError } from '../../lib/errors.js';
import { ProgressionService } from '../progression-service.js';
import { ProgressionMechanics } from './progression-mechanics.js';

import type {
  LevelUpOptions,
  LevelUpInput,
  LevelUpResult,
  HitPointIncrease,
  ClassFeature,
} from '../../types/progression.js';

export class LevelUpService {
  /**
   * Get level-up options for a character at a new level
   */
  static async getLevelUpOptions(
    characterId: string,
    newLevel: number,
    userId: string,
  ): Promise<LevelUpOptions> {
    // Get character
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
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
    const dieType = ProgressionMechanics.getHitDieType(className);
    const dieSize = parseInt(dieType.substring(1));
    const conModifier = ProgressionMechanics.calculateConModifier(character.stats.constitution);
    const averageRoll = Math.floor(dieSize / 2) + 1;

    const hasASI = ProgressionMechanics.grantsAbilityScoreImprovement(newLevel);

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
      abilityScoreOptions: hasASI
        ? {
            maxIncrease: 2,
            canTakeFeat: true,
          }
        : undefined,
      classFeatures,
      proficiencyBonus: ProgressionMechanics.calculateProficiencyBonus(newLevel),
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
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
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
      .where(
        and(
          eq(levelProgression.characterId, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
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
    const dieType = ProgressionMechanics.getHitDieType(className);
    const conModifier = ProgressionMechanics.calculateConModifier(character.stats.constitution);
    const roll = hpRoll || ProgressionMechanics.rollHitDie(dieType, true);
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
        .where(
          and(
            eq(characterStats.id, character.stats.id),
            eq(characterStats.characterId, characterId),
            exists(
              db
                .select()
                .from(characters)
                .where(
                  and(
                    eq(characters.id, characterId),
                    or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                  ),
                ),
            ),
          ),
        );

      // ⚡ Bolt: Parallelize all database updates for character level-up.
      // Stats, character record, and level progression are independent updates.
      // #273: XP is cumulative in 2014 rules -- levelling up never removes surplus XP.
      const newTotalXp = Math.max(
        character.experiencePoints ?? 0,
        ProgressionMechanics.getXPForLevel(newLevel),
      );
      const charUpdate = db
        .update(characters)
        .set({
          level: newLevel,
          experiencePoints: newTotalXp,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        );

      const progressionUpdate = db
        .update(levelProgression)
        .set({
          currentLevel: newLevel,
          currentXp: newTotalXp,
          totalXp: newTotalXp,
          xpToNextLevel: ProgressionMechanics.calculateXPToNextLevel(newLevel, newTotalXp),
          lastLevelUp: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(levelProgression.characterId, characterId),
            exists(
              db
                .select()
                .from(characters)
                .where(
                  and(
                    eq(characters.id, characterId),
                    or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                  ),
                ),
            ),
          ),
        );

      await Promise.all([statsUpdate, charUpdate, progressionUpdate]);
    } else {
      // ⚡ Bolt: Parallelize level and progression updates when no ASI is required.
      // #273: XP is cumulative in 2014 rules -- levelling up never removes surplus XP.
      const newTotalXp = Math.max(
        character.experiencePoints ?? 0,
        ProgressionMechanics.getXPForLevel(newLevel),
      );
      const charUpdate = db
        .update(characters)
        .set({
          level: newLevel,
          experiencePoints: newTotalXp,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        );

      const progressionUpdate = db
        .update(levelProgression)
        .set({
          currentLevel: newLevel,
          currentXp: newTotalXp,
          totalXp: newTotalXp,
          xpToNextLevel: ProgressionMechanics.calculateXPToNextLevel(newLevel, newTotalXp),
          lastLevelUp: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(levelProgression.characterId, characterId),
            exists(
              db
                .select()
                .from(characters)
                .where(
                  and(
                    eq(characters.id, characterId),
                    or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                  ),
                ),
            ),
          ),
        );

      await Promise.all([charUpdate, progressionUpdate]);
    }

    // Get class features for this level (placeholder)
    const newClassFeatures: ClassFeature[] = [];
    if (ProgressionMechanics.grantsAbilityScoreImprovement(newLevel)) {
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
      proficiencyBonus: ProgressionMechanics.calculateProficiencyBonus(newLevel),
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
    reason?: string,
  ): Promise<{ oldLevel: number; newLevel: number }> {
    if (level < 1 || level > 20) {
      throw new ValidationError('Level must be between 1 and 20', { level });
    }

    // Get current progression
    const results = await db
      .select({ progression: levelProgression })
      .from(levelProgression)
      .innerJoin(characters, eq(levelProgression.characterId, characters.id))
      .where(
        and(
          eq(levelProgression.characterId, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .limit(1);

    let progression = results[0]?.progression;

    if (!progression) {
      progression = await ProgressionService.initializeProgression(characterId, userId);
    }

    const oldLevel = progression.currentLevel;
    const newTotalXp = ProgressionMechanics.getXPForLevel(level);

    // ⚡ Bolt: Parallelize independent database updates for milestone leveling.
    // Progression update, character level update, and event logging are independent operations.
    // 🛡️ Sentinel: Added .returning() and check for updated rows to prevent unauthorized access success.
    const progressionUpdate = db
      .update(levelProgression)
      .set({
        currentLevel: level,
        currentXp: newTotalXp,
        totalXp: newTotalXp,
        xpToNextLevel: ProgressionMechanics.calculateXPToNextLevel(level, newTotalXp),
        lastLevelUp: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(levelProgression.characterId, characterId),
          exists(
            db
              .select()
              .from(characters)
              .where(
                and(
                  eq(characters.id, characterId),
                  or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                ),
              ),
          ),
        ),
      )
      .returning();

    const charUpdate = db
      .update(characters)
      .set({
        level,
        experiencePoints: newTotalXp,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .returning();

    // Was an insert-select projecting 5 of experience_events' 7 columns, which
    // Drizzle rejects at build time -- milestone level-ups have never written an
    // XP event. The progression UPDATE carries the same ownership filter, so
    // gating the insert on its result keeps the authorization guarantee.
    const [progRows] = await Promise.all([progressionUpdate, charUpdate]);

    if (progRows.length === 0) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character progression', characterId);
    }

    await db.insert(experienceEvents).values({
      characterId,
      sessionId: null,
      xpGained: 0,
      source: 'milestone',
      description: reason || `Milestone level set to ${level}`,
    });

    return { oldLevel, newLevel: level };
  }
}
