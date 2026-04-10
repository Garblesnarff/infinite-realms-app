/**
 * Class Feature Usage Service
 *
 * Handles tracking, logging, and restoration of D&D 5E class feature uses.
 * Extracted from ClassFeaturesService to modularize usage mechanics.
 *
 * @module server/services/progression/class-feature-usage-service
 */

import { eq, and, desc, sql, exists, or } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  characterFeatures,
  featureUsageLog,
  characters,
  classFeaturesLibrary,
  type CharacterFeature,
  type FeatureUsageLog,
} from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';

import type {
  UseFeatureInput,
  UseFeatureResult,
  RestoreFeaturesInput,
  RestoreFeaturesResult,
  CharacterFeaturesWithUsage,
  FeatureUsageHistoryParams,
} from '../../types/class-features.js';

/**
 * Class Feature Usage Service
 */
export class ClassFeatureUsageService {
  /**
   * Verify user owns the character.
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

  /**
   * Get feature usage information for a character
   */
  static async getFeatureUsage(
    characterId: string,
    featureId: string,
    userId: string
  ): Promise<number | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    userId: string,
    getCharacterFeatures: (characterId: string, userId: string) => Promise<CharacterFeature[]>
  ): Promise<CharacterFeaturesWithUsage> {
    const features = await getCharacterFeatures(characterId, userId);

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
}
