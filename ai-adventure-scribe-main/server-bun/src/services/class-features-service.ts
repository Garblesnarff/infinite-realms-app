/**
 * Class Features Service
 *
 * Implements D&D 5E class features system including feature library management,
 * character feature tracking, subclass selection, and feature usage/restoration.
 * Follows PHB pg. 45-119 for class features and progression.
 *
 * @module server/services/class-features-service
 */

import { eq, and, exists, or, isNull, inArray } from 'drizzle-orm';

import { ClassFeatureUsageService } from './progression/class-feature-usage-service.js';
import { SubclassService } from './subclass-service.js';
import { db } from '../../../db/client';
import {
  classFeaturesLibrary,
  characterFeatures,
  characters,
  type ClassFeatureLibrary,
  type CharacterFeature,
  type CharacterSubclass,
  type FeatureUsageLog,
} from '../../../db/schema/index';
import { NotFoundError, ConflictError } from '../lib/errors.js';

import type {
  GrantFeatureInput,
  UseFeatureInput,
  UseFeatureResult,
  RestoreFeaturesInput,
  RestoreFeaturesResult,
  SetSubclassInput,
  SetSubclassResult,
  GetFeaturesLibraryParams,
  AvailableSubclasses,
  CharacterFeaturesWithUsage,
  FeatureUsageHistoryParams,
} from '../types/class-features.js';

/**
 * Class Features Service
 */
export class ClassFeaturesService {
  // ============================================================================
  // Feature Library Management
  // ============================================================================

  /**
   * Get features from the library
   * Can filter by class name, subclass, and/or level
   */
  static async getFeaturesLibrary(
    params?: GetFeaturesLibraryParams,
  ): Promise<ClassFeatureLibrary[]> {
    const conditions = [];

    if (params?.className) {
      conditions.push(eq(classFeaturesLibrary.className, params.className));
    }

    if (params?.subclass) {
      conditions.push(eq(classFeaturesLibrary.subclassName, params.subclass));
    }

    if (params?.level !== undefined) {
      conditions.push(eq(classFeaturesLibrary.levelAcquired, params.level));
    }

    const features = await db.query.classFeaturesLibrary.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [classFeaturesLibrary.levelAcquired, classFeaturesLibrary.featureName],
    });

    return features;
  }

  /**
   * Get a specific feature by ID
   */
  static async getFeatureById(featureId: string): Promise<ClassFeatureLibrary | null> {
    const feature = await db.query.classFeaturesLibrary.findFirst({
      where: eq(classFeaturesLibrary.id, featureId),
    });

    return feature || null;
  }

  /**
   * Get all features for a class at a specific level
   */
  static async getFeaturesByLevel(
    className: string,
    level: number,
  ): Promise<ClassFeatureLibrary[]> {
    const features = await db.query.classFeaturesLibrary.findMany({
      where: and(
        eq(classFeaturesLibrary.className, className),
        eq(classFeaturesLibrary.levelAcquired, level),
      ),
    });

    return features;
  }

  /**
   * Get the level at which a class chooses its subclass
   */
  static getSubclassChoiceLevel(className: string): number {
    return SubclassService.getSubclassChoiceLevel(className);
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

  // ============================================================================
  // Character Feature Management
  // ============================================================================

  /**
   * Grant a feature to a character
   * ⚡ Bolt: Optimized to use a single atomic query for existence and ownership verification.
   */
  static async grantFeature(
    input: GrantFeatureInput & { userId: string },
  ): Promise<CharacterFeature> {
    const { characterId, featureId, acquiredAtLevel, userId } = input;

    // Was a single insert-select projecting 5 of character_features' 7 columns,
    // which Drizzle rejects at build time -- no feature has ever been granted on
    // this path. Ownership is now checked first, then the library row is read,
    // then a plain insert.
    //
    // Checking ownership up front also fixes a disclosure bug in the old fallback:
    // it looked up the existing feature row *unscoped*, so a non-owner probing a
    // character they cannot see got ConflictError ("already granted") instead of
    // NotFoundError, confirming both the character and the feature.
    await this.verifyCharacterOwnership(characterId, userId);

    const [pending] = await this.pendingLibraryFeatures(characterId, [featureId]);

    if (!pending) {
      const existing = await db.query.characterFeatures.findFirst({
        where: and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      });

      if (existing) {
        throw new ConflictError('Feature already granted to character', { featureId, characterId });
      }

      throw new NotFoundError('Feature', featureId);
    }

    const [granted] = await db
      .insert(characterFeatures)
      .values({
        characterId,
        featureId: pending.id,
        usesRemaining: pending.usesCount,
        isActive: true,
        acquiredAtLevel,
      })
      .returning();

    return granted;
  }

  /**
   * Grant multiple features to a character in a single batch operation.
   * ⚡ Bolt: Optimized to use a single INSERT ... SELECT query with joins to verify ownership
   * and skip already granted features in one round-trip.
   */
  static async grantFeaturesBatch(
    characterId: string,
    featureIds: string[],
    acquiredAtLevel: number,
    userId: string,
  ): Promise<CharacterFeature[]> {
    if (featureIds.length === 0) return [];

    // Same conversion as grantFeature. Still O(1) round-trips in the number of
    // features: one ownership check, one library read, one multi-row insert.
    await this.verifyCharacterOwnership(characterId, userId);

    const pending = await this.pendingLibraryFeatures(characterId, featureIds);

    if (pending.length === 0) return [];

    return db
      .insert(characterFeatures)
      .values(
        pending.map((feature) => ({
          characterId,
          featureId: feature.id,
          usesRemaining: feature.usesCount,
          isActive: true,
          acquiredAtLevel,
        })),
      )
      .returning();
  }

  /**
   * Library rows for `featureIds` that `characterId` has not already been granted.
   *
   * This is the LEFT JOIN / IS NULL half of the insert-selects that used to live in
   * grantFeature and grantFeaturesBatch, lifted out into a query of its own. It
   * deliberately does no authorization: both callers verify ownership first, and a
   * check that only runs as a side effect of a write is the thing that let the
   * broken insert-selects look safe while never executing at all.
   */
  private static async pendingLibraryFeatures(
    characterId: string,
    featureIds: string[],
  ): Promise<Array<{ id: string; usesCount: number | null }>> {
    return db
      .select({
        id: classFeaturesLibrary.id,
        usesCount: classFeaturesLibrary.usesCount,
      })
      .from(classFeaturesLibrary)
      .leftJoin(
        characterFeatures,
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, classFeaturesLibrary.id),
        ),
      )
      .where(and(inArray(classFeaturesLibrary.id, featureIds), isNull(characterFeatures.id)));
  }

  /**
   * Get all features for a character
   */
  static async getCharacterFeatures(
    characterId: string,
    userId: string,
  ): Promise<CharacterFeature[]> {
    const features = await db.query.characterFeatures.findMany({
      where: and(
        eq(characterFeatures.characterId, characterId),
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
      with: {
        feature: true,
      },
      orderBy: [characterFeatures.acquiredAtLevel],
    });

    return features;
  }

  /**
   * Get feature usage information for a character
   */
  static async getFeatureUsage(
    characterId: string,
    featureId: string,
    userId: string,
  ): Promise<number | null> {
    return ClassFeatureUsageService.getFeatureUsage(characterId, featureId, userId);
  }

  /**
   * Use a limited-use feature
   */
  static async useFeature(input: UseFeatureInput & { userId: string }): Promise<UseFeatureResult> {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return ClassFeatureUsageService.useFeature(input);
  }

  /**
   * Restore features after rest
   */
  static async restoreFeatures(
    input: RestoreFeaturesInput & { userId: string },
  ): Promise<RestoreFeaturesResult> {
    return ClassFeatureUsageService.restoreFeatures(input);
  }

  // ============================================================================
  // Subclass Management
  // ============================================================================

  /**
   * Set a character's subclass
   */
  static async setSubclass(
    input: SetSubclassInput & { userId: string },
  ): Promise<SetSubclassResult> {
    return SubclassService.setSubclass(input);
  }

  /**
   * Get character's subclass for a given class
   */
  static async getCharacterSubclass(
    characterId: string,
    className: string,
    userId: string,
  ): Promise<CharacterSubclass | null> {
    return SubclassService.getCharacterSubclass(characterId, className, userId);
  }

  /**
   * Get available subclasses for a class
   */
  static getAvailableSubclasses(className: string): AvailableSubclasses {
    return SubclassService.getAvailableSubclasses(className);
  }

  // ============================================================================
  // Feature Usage Tracking
  // ============================================================================

  /**
   * Log feature usage
   */
  static async logFeatureUsage(
    characterId: string,
    featureId: string,
    userId: string,
    context?: string,
    sessionId?: string,
  ): Promise<FeatureUsageLog> {
    return ClassFeatureUsageService.logFeatureUsage(
      characterId,
      featureId,
      userId,
      context,
      sessionId,
    );
  }

  /**
   * Get feature usage history
   */
  static async getFeatureUsageHistory(
    params: FeatureUsageHistoryParams & { userId: string },
  ): Promise<FeatureUsageLog[]> {
    return ClassFeatureUsageService.getFeatureUsageHistory(params);
  }

  /**
   * Get character features with usage information
   */
  static async getCharacterFeaturesWithUsage(
    characterId: string,
    userId: string,
  ): Promise<CharacterFeaturesWithUsage> {
    return ClassFeatureUsageService.getCharacterFeaturesWithUsage(
      characterId,
      userId,
      this.getCharacterFeatures.bind(this),
    );
  }

  /**
   * Grant all features for a character at a specific level
   * This is useful for level-up integration
   */
  static async grantFeaturesForLevel(
    characterId: string,
    className: string,
    level: number,
    userId: string,
  ): Promise<ClassFeatureLibrary[]> {
    // Get character to check for subclass and verify ownership
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    // Get subclass if character has one
    const subclass = await SubclassService.getCharacterSubclass(characterId, className, userId);

    // Get base class features for this level
    const classFeatures = await this.getFeaturesByLevel(className, level);

    // Get subclass features if applicable
    let subclassFeatures: ClassFeatureLibrary[] = [];
    if (subclass) {
      subclassFeatures = await db.query.classFeaturesLibrary.findMany({
        where: and(
          eq(classFeaturesLibrary.className, className),
          eq(classFeaturesLibrary.subclassName, subclass.subclassName),
          eq(classFeaturesLibrary.levelAcquired, level),
        ),
      });
    }

    const allFeatures = [...classFeatures, ...subclassFeatures].filter(
      (f) =>
        !f.featureName.includes('Archetype') &&
        !f.featureName.includes('Tradition') &&
        !f.featureName.includes('Domain'),
    );

    // ⚡ Bolt: Optimized to grant all features for the level in a single batch operation.
    // This reduces database round-trips from O(N) to O(1).
    const featureIds = allFeatures.map((f) => f.id);
    await this.grantFeaturesBatch(characterId, featureIds, level, userId);

    return allFeatures;
  }
}
