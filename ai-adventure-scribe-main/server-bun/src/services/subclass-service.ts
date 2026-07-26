/**
 * Subclass Service
 *
 * Extracted from ClassFeaturesService.
 * Handles D&D 5E subclass selection, availability, and character subclass tracking.
 * Follows PHB subclass progression rules.
 *
 * @module server/services/subclass-service
 */

import { eq, and, exists, or } from 'drizzle-orm';

import { ClassFeaturesService } from './class-features-service.js';
import { db } from '../../../db/client';
import { classFeaturesLibrary, characterSubclasses, characters } from '../../../db/schema/index';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  BusinessLogicError,
} from '../lib/errors.js';
import { SUBCLASS_CHOICE_LEVELS, AVAILABLE_SUBCLASSES } from '../types/class-features.js';

import type {
  SetSubclassInput,
  SetSubclassResult,
  CharacterSubclass,
  AvailableSubclasses,
} from '../types/class-features.js';

export class SubclassService {
  /**
   * Get the level at which a class chooses its subclass
   */
  static getSubclassChoiceLevel(className: string): number {
    return SUBCLASS_CHOICE_LEVELS[className] || 3;
  }

  /**
   * Set a character's subclass
   */
  static async setSubclass(
    input: SetSubclassInput & { userId: string },
  ): Promise<SetSubclassResult> {
    const { characterId, className, subclassName, level, userId } = input;

    // Verify character exists and verify ownership
    await this.verifyCharacterOwnership(characterId, userId);

    // Verify subclass is valid for the class
    const validSubclasses = AVAILABLE_SUBCLASSES[className];
    if (!validSubclasses || !validSubclasses.includes(subclassName)) {
      throw new ValidationError(`${subclassName} is not a valid subclass for ${className}`, {
        className,
        subclassName,
        validSubclasses,
      });
    }

    // Check if subclass already set for this class
    const existing = await db.query.characterSubclasses.findFirst({
      where: and(
        eq(characterSubclasses.characterId, characterId),
        eq(characterSubclasses.className, className),
      ),
    });

    if (existing) {
      throw new ConflictError(
        `Character already has subclass ${existing.subclassName} for ${className}. Subclass choices are permanent.`,
        { existingSubclass: existing.subclassName, className },
      );
    }

    // Verify level is appropriate for subclass choice
    const requiredLevel = this.getSubclassChoiceLevel(className);
    if (level < requiredLevel) {
      throw new BusinessLogicError(
        `${className} chooses subclass at level ${requiredLevel}. Character is level ${level}.`,
        { className, requiredLevel, characterLevel: level },
      );
    }

    // Set the subclass.
    // The insert-select projected 4 of character_subclasses' 6 columns and Drizzle
    // rejected it, so choosing a subclass never persisted. verifyCharacterOwnership
    // at the top of this method is the authorization; this is just the write.
    await db.insert(characterSubclasses).values({
      characterId,
      className,
      subclassName,
      chosenAtLevel: level,
    });

    // Get subclass features acquired at the choice level
    const subclassFeatures = await db.query.classFeaturesLibrary.findMany({
      where: and(
        eq(classFeaturesLibrary.className, className),
        eq(classFeaturesLibrary.subclassName, subclassName),
        eq(classFeaturesLibrary.levelAcquired, requiredLevel),
      ),
    });

    // Grant subclass features
    // ⚡ Bolt: Optimized to grant all subclass features in a single batch operation.
    // This reduces database round-trips from O(N) to O(1).
    const featureIds = subclassFeatures.map((f) => f.id);
    await ClassFeaturesService.grantFeaturesBatch(characterId, featureIds, level, userId);

    const newFeatures = subclassFeatures;

    return {
      subclass: subclassName,
      newFeatures,
      message: `Subclass ${subclassName} chosen for ${className}. Granted ${newFeatures.length} features.`,
    };
  }

  /**
   * Get character's subclass for a given class
   */
  static async getCharacterSubclass(
    characterId: string,
    className: string,
    userId: string,
  ): Promise<CharacterSubclass | null> {
    if (userId) {
      await this.verifyCharacterOwnership(characterId, userId);
    }

    const subclass = await db.query.characterSubclasses.findFirst({
      where: and(
        eq(characterSubclasses.characterId, characterId),
        eq(characterSubclasses.className, className),
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
    });

    return subclass || null;
  }

  /**
   * Get available subclasses for a class
   */
  static getAvailableSubclasses(className: string): AvailableSubclasses {
    const subclasses = AVAILABLE_SUBCLASSES[className] || [];

    return {
      className,
      subclasses,
    };
  }

  /**
   * Verify user owns the character (direct owner or shared owner field).
   * Throws NOT_FOUND to avoid disclosing character existence.
   */
  private static async verifyCharacterOwnership(
    characterId: string,
    userId: string,
  ): Promise<void> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
      columns: { id: true },
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }
  }
}
