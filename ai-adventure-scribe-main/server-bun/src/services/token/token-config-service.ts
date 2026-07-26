/**
 * Token Configuration Service
 *
 * Extracted from TokenService.
 * Handles token vision, light, and default configuration.
 *
 * @module server-bun/services/token/token-config-service
 */

import { TRPCError } from '@trpc/server';
import { eq, and, or, exists, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  tokens,
  tokenConfigurations,
  scenes,
  characters,
  type Token,
  type NewToken,
  type TokenConfiguration,
  type NewTokenConfiguration,
} from '../../../../db/schema/index';

import type { TokenService } from '../token-service';

/**
 * Token vision configuration interface
 */
export interface TokenVisionConfig {
  visionEnabled?: boolean;
  visionRange?: number;
  visionAngle?: number;
  nightVision?: boolean;
  darkvisionRange?: number;
}

/**
 * Token light configuration interface
 */
export interface TokenLightConfig {
  emitsLight?: boolean;
  lightRange?: number;
  lightAngle?: number;
  lightColor?: string;
  lightIntensity?: number;
  dimLightRange?: number;
  brightLightRange?: number;
}

export class TokenConfigService {
  /**
   * Update token vision configuration
   */
  static async updateVision(
    tokenId: string,
    userId: string,
    visionConfig: TokenVisionConfig,
    tokenService: typeof TokenService,
  ): Promise<Token | null> {
    const updates: Partial<NewToken> = {};

    if (visionConfig.visionEnabled !== undefined) {
      updates.visionEnabled = visionConfig.visionEnabled;
    }
    if (visionConfig.visionRange !== undefined) {
      updates.visionRange = String(visionConfig.visionRange);
    }
    if (visionConfig.visionAngle !== undefined) {
      updates.visionAngle = String(visionConfig.visionAngle);
    }
    if (visionConfig.nightVision !== undefined) {
      updates.nightVision = visionConfig.nightVision;
    }
    if (visionConfig.darkvisionRange !== undefined) {
      updates.darkvisionRange = String(visionConfig.darkvisionRange);
    }

    return tokenService.updateToken(tokenId, userId, updates);
  }

  /**
   * Update token light configuration
   */
  static async updateLight(
    tokenId: string,
    userId: string,
    lightConfig: TokenLightConfig,
    tokenService: typeof TokenService,
  ): Promise<Token | null> {
    const updates: Partial<NewToken> = {};

    if (lightConfig.emitsLight !== undefined) {
      updates.emitsLight = lightConfig.emitsLight;
    }
    if (lightConfig.lightRange !== undefined) {
      updates.lightRange = String(lightConfig.lightRange);
    }
    if (lightConfig.lightAngle !== undefined) {
      updates.lightAngle = String(lightConfig.lightAngle);
    }
    if (lightConfig.lightColor !== undefined) {
      updates.lightColor = lightConfig.lightColor;
    }
    if (lightConfig.lightIntensity !== undefined) {
      updates.lightIntensity = String(lightConfig.lightIntensity);
    }
    if (lightConfig.dimLightRange !== undefined) {
      updates.dimLightRange = String(lightConfig.dimLightRange);
    }
    if (lightConfig.brightLightRange !== undefined) {
      updates.brightLightRange = String(lightConfig.brightLightRange);
    }

    return tokenService.updateToken(tokenId, userId, updates);
  }

  /**
   * Get default token configuration for a character
   */
  static async getDefaultTokenConfig(
    characterId: string,
    userId: string,
  ): Promise<TokenConfiguration | null> {
    // ⚡ Bolt: Consolidate ownership verification and configuration retrieval into a single query.
    // This reduces database round-trips from 2 to 1 and maintains security masking by throwing 404 if the character is missing or unowned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result] = await (db as any)
      .select({
        characterId: characters.id,
        config: tokenConfigurations,
      })
      .from(characters)
      .leftJoin(tokenConfigurations, eq(characters.id, tokenConfigurations.characterId))
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .limit(1);

    if (!result) {
      // 🛡️ Sentinel: Throw NOT_FOUND if character doesn't exist or user doesn't own it
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
    }

    // Drizzle returns an object with null fields for left-joined tables if no row matches.
    // We check for the presence of the config ID to determine if a configuration actually exists.
    return result.config?.id ? result.config : null;
  }

  /**
   * Update default token configuration for a character
   */
  static async updateDefaultTokenConfig(
    characterId: string,
    userId: string,
    config: Partial<NewTokenConfiguration>,
  ): Promise<TokenConfiguration> {
    // ⚡ Bolt: Removed redundant verifyCharacterOwnership call as it's now handled by consolidated getDefaultTokenConfig.
    // This reduces total round-trips in the update path from 4 to 2.
    const existing = await this.getDefaultTokenConfig(characterId, userId);

    if (existing) {
      // Update existing config
      // 🛡️ Sentinel: Atomic update with ownership check (characterId ownership)
      const [updated] = await db
        .update(tokenConfigurations)
        .set({
          ...config,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tokenConfigurations.id, existing.id),
            eq(tokenConfigurations.characterId, characterId),
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

      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Character or token configuration not found',
        });
      }

      return updated;
    } else {
      // Create new config.
      // Character-ownership check split out of the insert: as an insert-select this
      // projected 28 of token_configurations' 32 columns (missing id, monsterId,
      // createdAt, updatedAt), so Drizzle rejected it and a token configuration
      // could only ever be updated, never created.
      const owned = await db
        .select({ one: sql`1` })
        .from(characters)
        .where(
          and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        )
        .limit(1);

      if (owned.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Character not found',
        });
      }

      const [created] = await db
        .insert(tokenConfigurations)
        .values({
          characterId,
          imageUrl: config.imageUrl ?? null,
          avatarUrl: config.avatarUrl ?? null,
          sizeWidth: config.sizeWidth ?? '1.0',
          sizeHeight: config.sizeHeight ?? '1.0',
          gridSize: config.gridSize ?? 'medium',
          tintColor: config.tintColor ?? null,
          scale: config.scale ?? '1.0',
          opacity: config.opacity ?? '1.0',
          borderColor: config.borderColor ?? null,
          borderWidth: config.borderWidth ?? 2,
          showNameplate: config.showNameplate ?? true,
          nameplatePosition: config.nameplatePosition ?? 'bottom',
          visionEnabled: config.visionEnabled ?? false,
          visionRange: config.visionRange ?? null,
          visionAngle: config.visionAngle ?? null,
          nightVision: config.nightVision ?? false,
          darkvisionRange: config.darkvisionRange ?? null,
          emitsLight: config.emitsLight ?? false,
          lightRange: config.lightRange ?? null,
          lightAngle: config.lightAngle ?? null,
          lightColor: config.lightColor ?? null,
          lightIntensity: config.lightIntensity ?? null,
          dimLightRange: config.dimLightRange ?? null,
          brightLightRange: config.brightLightRange ?? null,
          movementSpeed: config.movementSpeed ?? null,
          hasFlying: config.hasFlying ?? false,
          hasSwimming: config.hasSwimming ?? false,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Character not found',
        });
      }

      return created;
    }
  }

  /**
   * Apply default configuration to a token
   */
  static async applyDefaultConfig(
    tokenId: string,
    userId: string,
    tokenService: typeof TokenService,
  ): Promise<Token | null> {
    // ⚡ Bolt: Consolidate token retrieval, character ownership verification, and default configuration lookup into a single query.
    // This reduces database round-trips from 3 to 2 (consolidated fetch + update).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result] = await (db as any)
      .select({
        token: tokens,
        character: characters,
        config: tokenConfigurations,
      })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .leftJoin(characters, eq(tokens.actorId, characters.id))
      .leftJoin(tokenConfigurations, eq(characters.id, tokenConfigurations.characterId))
      .where(and(eq(tokens.id, tokenId), eq(scenes.userId, userId)))
      .limit(1);

    if (!result) return null;

    const { token, character, config } = result;

    if (!token.actorId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Token is not linked to a character',
      });
    }

    // Verify character ownership (matches verifyCharacterOwnership behavior)
    if (!character || (character.userId !== userId && character.ownerId !== userId)) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Character not found',
      });
    }

    if (!config?.id) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No default token configuration found for this character',
      });
    }

    // Apply config to token
    return tokenService.updateToken(tokenId, userId, {
      imageUrl: config.imageUrl,
      avatarUrl: config.avatarUrl,
      sizeWidth: config.sizeWidth ?? undefined,
      sizeHeight: config.sizeHeight ?? undefined,
      gridSize: config.gridSize ?? undefined,
      tintColor: config.tintColor,
      scale: config.scale,
      opacity: config.opacity,
      borderColor: config.borderColor,
      borderWidth: config.borderWidth,
      showNameplate: config.showNameplate,
      nameplatePosition: config.nameplatePosition,
      visionEnabled: config.visionEnabled,
      visionRange: config.visionRange,
      visionAngle: config.visionAngle,
      nightVision: config.nightVision,
      darkvisionRange: config.darkvisionRange,
      emitsLight: config.emitsLight,
      lightRange: config.lightRange,
      lightAngle: config.lightAngle,
      lightColor: config.lightColor,
      lightIntensity: config.lightIntensity,
      dimLightRange: config.dimLightRange,
      brightLightRange: config.brightLightRange,
      movementSpeed: config.movementSpeed,
      hasFlying: config.hasFlying,
      hasSwimming: config.hasSwimming,
    });
  }
}
