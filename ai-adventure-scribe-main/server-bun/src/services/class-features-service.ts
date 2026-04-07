/**
 * Class Features Service
 *
 * Implements D&D 5E class features system including feature library management,
 * character feature tracking, subclass selection, and feature usage/restoration.
 * Follows PHB pg. 45-119 for class features and progression.
 *
 * @module server/services/class-features-service
 */

import { eq, and, desc, sql, exists, or, isNull, inArray } from 'drizzle-orm';

import { db } from '../../../db/client';
import { SubclassService } from './subclass-service.js';
import {
  classFeaturesLibrary,
  characterFeatures,
  characterSubclasses,
  featureUsageLog,
  characters,
  type ClassFeatureLibrary,
  type CharacterFeature,
  type CharacterSubclass,
  type FeatureUsageLog,
} from '../../../db/schema/index';
import { NotFoundError, ConflictError, BusinessLogicError } from '../lib/errors.js';

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
    params?: GetFeaturesLibraryParams
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
    level: number
  ): Promise<ClassFeatureLibrary[]> {
    const features = await db.query.classFeaturesLibrary.findMany({
      where: and(
        eq(classFeaturesLibrary.className, className),
        eq(classFeaturesLibrary.levelAcquired, level)
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
  private static async verifyCharacterOwnership(characterId: string, userId: string): Promise<void> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
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
  static async grantFeature(input: GrantFeatureInput & { userId: string }): Promise<CharacterFeature> {
    const { characterId, featureId, acquiredAtLevel, userId } = input;

    // ⚡ Bolt: Combined check for existing feature, character ownership, and library feature data.
    // This reduces database round-trips from 4 down to 1.
    const [granted] = await db
      .insert(characterFeatures)
      .select(
        db
          .select({
            characterId: sql`${characterId}`,
            featureId: classFeaturesLibrary.id,
            usesRemaining: classFeaturesLibrary.usesCount,
            isActive: sql`true`,
            acquiredAtLevel: sql`${acquiredAtLevel}`,
          })
          .from(classFeaturesLibrary)
          .innerJoin(characters, and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
          .leftJoin(characterFeatures, and(
            eq(characterFeatures.characterId, characterId),
            eq(characterFeatures.featureId, classFeaturesLibrary.id)
          ))
          .where(and(
            eq(classFeaturesLibrary.id, featureId),
            isNull(characterFeatures.id)
          ))
      )
      .returning();

    if (!granted) {
      // If insertion failed, it could be because the feature is already granted,
      // the character doesn't exist/isn't owned, or the feature ID is invalid.
      // We perform one fallback check to throw the correct error.
      const existing = await db.query.characterFeatures.findFirst({
        where: and(eq(characterFeatures.characterId, characterId), eq(characterFeatures.featureId, featureId))
      });

      if (existing) {
        throw new ConflictError('Feature already granted to character', { featureId, characterId });
      }

      await this.verifyCharacterOwnership(characterId, userId);
      throw new NotFoundError('Feature', featureId);
    }

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
    userId: string
  ): Promise<CharacterFeature[]> {
    if (featureIds.length === 0) return [];

    // 🛡️ Sentinel: Incorporate ownership check and "not already granted" check into a single atomic query.
    // This reduces O(N) database round-trips to O(1).
    const granted = await db
      .insert(characterFeatures)
      .select(
        db
          .select({
            characterId: sql`${characterId}`,
            featureId: classFeaturesLibrary.id,
            usesRemaining: classFeaturesLibrary.usesCount,
            isActive: sql`true`,
            acquiredAtLevel: sql`${acquiredAtLevel}`,
          })
          .from(classFeaturesLibrary)
          .innerJoin(characters, and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
          .leftJoin(characterFeatures, and(
            eq(characterFeatures.characterId, characterId),
            eq(characterFeatures.featureId, classFeaturesLibrary.id)
          ))
          .where(and(
            inArray(classFeaturesLibrary.id, featureIds),
            isNull(characterFeatures.id) // Only insert if not already granted
          ))
      )
      .returning();

    return granted;
  }

  /**
   * Get all features for a character
   */
  static async getCharacterFeatures(characterId: string, userId: string): Promise<CharacterFeature[]> {
    const features = await db.query.characterFeatures.findMany({
      where: and(
        eq(characterFeatures.characterId, characterId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
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
    userId: string
  ): Promise<number | null> {
    // ⚡ Bolt: Removed redundant verifyCharacterOwnership call.
    // Ownership is verified atomically within the main characterFeatures query via an explicit JOIN.
    // This reduces database round-trips from 2 to 1.

    const [characterFeature] = await (db as any)
      .select({
        usesRemaining: characterFeatures.usesRemaining,
      })
      .from(characterFeatures)
      .innerJoin(characters, eq(characterFeatures.characterId, characters.id))
      .where(and(
        eq(characterFeatures.characterId, characterId),
        eq(characterFeatures.featureId, featureId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    if (!characterFeature) {
      throw new NotFoundError('Feature for character', characterId);
    }

    return characterFeature.usesRemaining;
  }

  /**
   * Use a limited-use feature
   */
  static async useFeature(input: UseFeatureInput & { userId: string }): Promise<UseFeatureResult> {
    const { characterId, featureId, context, sessionId, userId } = input;

    // Get character feature with ownership check
    const characterFeature = await db.query.characterFeatures.findFirst({
      where: and(
        eq(characterFeatures.characterId, characterId),
        eq(characterFeatures.featureId, featureId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ),
      with: {
        feature: true,
      },
    });

    if (!characterFeature) {
      return {
        success: false,
        usesRemaining: 0,
        effect: '',
        message: 'Feature not found for this character',
      };
    }

    const feature = characterFeature.feature!;

    // Check if feature has limited uses
    if (feature.usageType !== 'limited_use' && feature.usesCount === null) {
      // Passive or at-will features don't track uses, but we still log them
      await this.logFeatureUsage(characterId, featureId, userId, context, sessionId);

      return {
        success: true,
        usesRemaining: -1, // -1 indicates unlimited
        effect: feature.mechanicalEffects || feature.description,
        message: `${feature.featureName} activated`,
      };
    }

    // Check if feature has uses remaining
    if (characterFeature.usesRemaining === null || characterFeature.usesRemaining <= 0) {
      return {
        success: false,
        usesRemaining: 0,
        effect: '',
        message: `No uses remaining for ${feature.featureName}`,
      };
    }

    // Decrement uses
    const newUsesRemaining = characterFeature.usesRemaining - 1;
    // 🛡️ Sentinel: Incorporate ownership check into the UPDATE query for defense-in-depth.
    await db
      .update(characterFeatures)
      .set({ usesRemaining: newUsesRemaining })
      .where(and(
        eq(characterFeatures.id, characterFeature.id),
        eq(characterFeatures.characterId, characterId),
        eq(characterFeatures.featureId, featureId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ));

    // Log the usage
    await this.logFeatureUsage(characterId, featureId, userId, context, sessionId);

    return {
      success: true,
      usesRemaining: newUsesRemaining,
      effect: feature.mechanicalEffects || feature.description,
      message: `${feature.featureName} used. ${newUsesRemaining} uses remaining.`,
    };
  }

  /**
   * Restore features after rest
   */
  static async restoreFeatures(
    input: RestoreFeaturesInput & { userId: string }
  ): Promise<RestoreFeaturesResult> {
    const { characterId, restType, userId } = input;

    // Get all character features with ownership check
    // ⚡ Bolt: Optimized N+1 update loop into a single atomic UPDATE ... FROM query.
    // This reduces database round-trips from O(N) (number of character features) to O(1).
    // 🛡️ Sentinel: Incorporate ownership check into the batch UPDATE query for defense-in-depth.
    const restoredRows = await db.execute<{ feature_name: string }>(sql`
      UPDATE ${characterFeatures} cf
      SET uses_remaining = cfl.uses_count
      FROM ${classFeaturesLibrary} cfl
      WHERE cf.feature_id = cfl.id
        AND cf.character_id = ${characterId}
        AND cfl.uses_count IS NOT NULL
        AND (
          (${restType} = 'short' AND cfl.uses_per_rest = 'short_rest')
          OR
          (${restType} = 'long' AND (cfl.uses_per_rest = 'short_rest' OR cfl.uses_per_rest = 'long_rest'))
        )
        AND EXISTS (
          SELECT 1 FROM ${characters} c
          WHERE c.id = cf.character_id
          AND (c.user_id = ${userId} OR c.owner_id = ${userId})
        )
      RETURNING cfl.feature_name
    `);

    const featuresRestored = restoredRows.map(row => row.feature_name);

    return {
      featuresRestored,
      restoredCount: featuresRestored.length,
    };
  }

  // ============================================================================
  // Subclass Management
  // ============================================================================

  /**
   * Set a character's subclass
   */
  static async setSubclass(input: SetSubclassInput & { userId: string }): Promise<SetSubclassResult> {
    return SubclassService.setSubclass(input);
  }

  /**
   * Get character's subclass for a given class
   */
  static async getCharacterSubclass(
    characterId: string,
    className: string,
    userId: string
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
    sessionId?: string
  ): Promise<FeatureUsageLog> {
    // Verify ownership before logging
    const [character] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [log] = await db
      .insert(featureUsageLog)
      .select(
        db
          .select({
            characterId: sql`${characterId}`,
            featureId: sql`${featureId}`,
            sessionId: sql`${sessionId || null}`,
            context: sql`${context || null}`,
          })
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            )
          )
      )
      .returning();

    if (!log) {
      throw new NotFoundError('Character', characterId);
    }

    return log;
  }

  /**
   * Get feature usage history
   */
  static async getFeatureUsageHistory(
    params: FeatureUsageHistoryParams & { userId: string }
  ): Promise<FeatureUsageLog[]> {
    const { characterId, featureId, sessionId, limit = 50, userId } = params;

    const conditions = [
      eq(featureUsageLog.characterId, characterId),
      exists(
        db.select()
          .from(characters)
          .where(and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
      )
    ];

    if (featureId) {
      conditions.push(eq(featureUsageLog.featureId, featureId));
    }

    if (sessionId) {
      conditions.push(eq(featureUsageLog.sessionId, sessionId));
    }

    const history = await db.query.featureUsageLog.findMany({
      where: conditions.length > 1 ? and(...conditions) : conditions[0],
      with: {
        feature: true,
      },
      orderBy: [desc(featureUsageLog.usedAt)],
      limit,
    });

    return history;
  }

  /**
   * Get character features with usage information
   */
  static async getCharacterFeaturesWithUsage(
    characterId: string,
    userId: string
  ): Promise<CharacterFeaturesWithUsage> {
    const features = await this.getCharacterFeatures(characterId, userId);

    const usesRemaining: Record<string, number> = {};

    for (const feature of features) {
      if (feature.usesRemaining !== null) {
        usesRemaining[feature.featureId] = feature.usesRemaining;
      }
    }

    return {
      features,
      usesRemaining,
    };
  }

  /**
   * Grant all features for a character at a specific level
   * This is useful for level-up integration
   */
  static async grantFeaturesForLevel(
    characterId: string,
    className: string,
    level: number,
    userId: string
  ): Promise<ClassFeatureLibrary[]> {
    // Get character to check for subclass and verify ownership
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
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
          eq(classFeaturesLibrary.levelAcquired, level)
        ),
      });
    }

    const allFeatures = [...classFeatures, ...subclassFeatures]
      .filter(f => !f.featureName.includes('Archetype') &&
                   !f.featureName.includes('Tradition') &&
                   !f.featureName.includes('Domain'));

    // ⚡ Bolt: Optimized to grant all features for the level in a single batch operation.
    // This reduces database round-trips from O(N) to O(1).
    const featureIds = allFeatures.map(f => f.id);
    await this.grantFeaturesBatch(characterId, featureIds, level, userId);

    return allFeatures;
  }
}
