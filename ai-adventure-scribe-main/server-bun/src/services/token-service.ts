/* eslint-disable max-lines */
/**
 * Token Service
 *
 * Handles token management operations using Drizzle ORM.
 * Provides type-safe database queries for token CRUD, character linking,
 * vision/light configuration, and authorization checks.
 *
 * @module server/services/token-service
 */

import { TRPCError } from '@trpc/server';
import { eq, and, desc, or, exists } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  tokens,
  tokenConfigurations,
  characterTokens,
  scenes,
  characters,
  type Token,
  type NewToken,
  type TokenConfiguration,
  type NewTokenConfiguration,
} from '../../../db/schema/index.js';

/**
 * Token creation data interface
 */
export interface CreateTokenData {
  sceneId: string;
  actorId?: string; // character ID
  name: string;
  tokenType: string;
  positionX: number;
  positionY: number;
  imageUrl?: string;
  sizeWidth?: number;
  sizeHeight?: number;
  gridSize?: string;
  visionEnabled?: boolean;
  visionRange?: number;
  emitsLight?: boolean;
  lightRange?: number;
  lightColor?: string;
}

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

export class TokenService {
  /**
   * Verify user has access to a scene (through campaign ownership)
   */
  private static async verifySceneAccess(sceneId: string, userId: string): Promise<boolean> {
    const scene = await db.query.scenes.findFirst({
      where: and(eq(scenes.id, sceneId), eq(scenes.userId, userId)),
    });

    if (!scene) {
      // 🛡️ Sentinel: Throw NOT_FOUND instead of FORBIDDEN to mask resource existence
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Scene not found' });
    }

    return true;
  }

  /**
   * Verify user owns a character
   */
  private static async verifyCharacterOwnership(characterId: string, userId: string): Promise<boolean> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
    });

    if (!character) {
      // We throw NOT_FOUND to avoid leaking the existence of characters the user doesn't own
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
    }

    return true;
  }

  /**
   * List all tokens for a scene
   */
  static async listTokensForScene(sceneId: string, userId: string): Promise<Token[]> {
    // 🛡️ Sentinel: Combine ownership check into the query to prevent existence leakage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await (db as any)
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(
        eq(tokens.sceneId, sceneId),
        eq(scenes.userId, userId)
      ))
      .orderBy(desc(tokens.createdAt));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.map((r: any) => r.token);
  }

  /**
   * Get a single token by ID with full configuration
   */
  static async getTokenById(tokenId: string, userId: string): Promise<Token | null> {
    // 🛡️ Sentinel: Combine ownership check into the query to prevent existence leakage
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result] = await (db as any)
      .select({ token: tokens })
      .from(tokens)
      .innerJoin(scenes, eq(tokens.sceneId, scenes.id))
      .where(and(
        eq(tokens.id, tokenId),
        eq(scenes.userId, userId)
      ))
      .limit(1);

    return result?.token || null;
  }

  /**
   * Create a new token
   */
  static async createToken(
    sceneId: string,
    userId: string,
    data: CreateTokenData
  ): Promise<Token> {
    // ⚡ Bolt: Parallelize independent authorization checks to reduce aggregate database latency.
    await Promise.all([
      this.verifySceneAccess(sceneId, userId),
      data.actorId ? this.verifyCharacterOwnership(data.actorId, userId) : Promise.resolve(true),
    ]);

    // Create token
    const [token] = await db
      .insert(tokens)
      .values({
        sceneId: data.sceneId,
        actorId: data.actorId || null,
        createdBy: userId,
        name: data.name,
        tokenType: data.tokenType,
        positionX: String(data.positionX),
        positionY: String(data.positionY),
        imageUrl: data.imageUrl || null,
        sizeWidth: data.sizeWidth ? String(data.sizeWidth) : '1.0',
        sizeHeight: data.sizeHeight ? String(data.sizeHeight) : '1.0',
        gridSize: data.gridSize || 'medium',
        visionEnabled: data.visionEnabled || false,
        visionRange: data.visionRange ? String(data.visionRange) : null,
        emitsLight: data.emitsLight || false,
        lightRange: data.lightRange ? String(data.lightRange) : null,
        lightColor: data.lightColor || null,
      })
      .returning();

    if (!token) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create token' });
    }

    // If actorId is provided, create character-token link
    if (data.actorId) {
      await db.insert(characterTokens).values({
        characterId: data.actorId,
        tokenId: token.id,
      });
    }

    return token;
  }

  /**
   * Update an existing token
   */
  static async updateToken(
    tokenId: string,
    userId: string,
    updates: Partial<NewToken>,
    onBroadcast?: (sceneId: string, token: Token) => void
  ): Promise<Token | null> {
    // 🛡️ Sentinel: Atomic update with ownership check via exists subquery
    // We specifically omit internal/security fields from the update object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { id: _id, sceneId: _sceneId, createdBy: _createdBy, ...safeUpdates } = updates as any;

    const [updated] = await db
      .update(tokens)
      .set({
        ...safeUpdates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(tokens.id, tokenId),
        exists(
          db.select()
            .from(scenes)
            .where(and(
              eq(scenes.id, tokens.sceneId),
              eq(scenes.userId, userId)
            ))
        )
      ))
      .returning();

    // Broadcast update via WebSocket if callback provided
    if (updated && onBroadcast) {
      onBroadcast(updated.sceneId, updated);
    }

    return updated || null;
  }

  /**
   * Delete a token
   */
  static async deleteToken(tokenId: string, userId: string): Promise<boolean> {
    // 🛡️ Sentinel: Atomic delete with ownership check via exists subquery
    const result = await db
      .delete(tokens)
      .where(and(
        eq(tokens.id, tokenId),
        exists(
          db.select()
            .from(scenes)
            .where(and(
              eq(scenes.id, tokens.sceneId),
              eq(scenes.userId, userId)
            ))
        )
      ))
      .returning({ id: tokens.id });

    return result.length > 0;
  }

  /**
   * Move a token (update position)
   */
  static async moveToken(
    tokenId: string,
    userId: string,
    newX: number,
    newY: number,
    onBroadcast?: (sceneId: string, token: Token) => void
  ): Promise<Token | null> {
    return this.updateToken(tokenId, userId, {
      positionX: String(newX),
      positionY: String(newY),
    }, onBroadcast);
  }

  /**
   * Link a token to a character
   */
  static async linkToCharacter(
    tokenId: string,
    characterId: string,
    userId: string
  ): Promise<boolean> {
    // ⚡ Bolt: Consolidate authorization and update into fewer round-trips.
    // We check both scene and character ownership directly in the token update.
    const [updated] = await db
      .update(tokens)
      .set({ actorId: characterId, updatedAt: new Date() })
      .where(and(
        eq(tokens.id, tokenId),
        // Scene ownership check
        exists(
          db.select()
            .from(scenes)
            .where(and(
              eq(scenes.id, tokens.sceneId),
              eq(scenes.userId, userId)
            ))
        ),
        // Character ownership check
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

    if (!updated) {
      // 🛡️ Sentinel: Throw NOT_FOUND to mask whether it was the token or character that was missing/unauthorized
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Token or character not found' });
    }

    // Create or update character-token link
    try {
      await db.insert(characterTokens).values({
        characterId,
        tokenId,
      });
    } catch {
      // Link may already exist, that's ok
    }

    return true;
  }

  /**
   * Unlink a token from a character
   */
  static async unlinkFromCharacter(
    tokenId: string,
    characterId: string,
    userId: string
  ): Promise<boolean> {
    // Verify character ownership first
    await this.verifyCharacterOwnership(characterId, userId);

    // ⚡ Bolt: Parallelize independent database operations to reduce aggregate latency.
    await Promise.all([
      // Remove character-token link
      db.delete(characterTokens)
        .where(
          and(eq(characterTokens.characterId, characterId), eq(characterTokens.tokenId, tokenId))
        ),
      // 🛡️ Sentinel: Clear actorId with atomic ownership check
      db.update(tokens)
        .set({ actorId: null, updatedAt: new Date() })
        .where(and(
          eq(tokens.id, tokenId),
          eq(tokens.actorId, characterId),
          exists(
            db.select()
              .from(scenes)
              .where(and(
                eq(scenes.id, tokens.sceneId),
                eq(scenes.userId, userId)
              ))
          )
        ))
    ]);

    return true;
  }

  /**
   * Get all tokens for a character
   */
  static async getTokensForCharacter(characterId: string, userId: string): Promise<Token[]> {
    // Verify character ownership
    await this.verifyCharacterOwnership(characterId, userId);

    // Get all tokens linked to this character using relation (single query instead of 2)
    const links = await db.query.characterTokens.findMany({
      where: eq(characterTokens.characterId, characterId),
      with: {
        token: true,
      },
    });

    // Extract tokens from the links, filtering out any null tokens
    return links
      .map((link: { token: Token | null }) => link.token)
      .filter((token): token is Token => token !== null);
  }

  /**
   * Update token vision configuration
   */
  static async updateVision(
    tokenId: string,
    userId: string,
    visionConfig: TokenVisionConfig
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

    return this.updateToken(tokenId, userId, updates);
  }

  /**
   * Update token light configuration
   */
  static async updateLight(
    tokenId: string,
    userId: string,
    lightConfig: TokenLightConfig
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

    return this.updateToken(tokenId, userId, updates);
  }

  /**
   * Get default token configuration for a character
   */
  static async getDefaultTokenConfig(characterId: string, userId: string): Promise<TokenConfiguration | null> {
    // ⚡ Bolt: Consolidate configuration fetching and ownership verification into a single database operation
    // using a JOIN to reduce round-trips. This masks resource existence for unauthorized users.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [result] = await (db as any)
      .select({ config: tokenConfigurations })
      .from(characters)
      .leftJoin(tokenConfigurations, eq(characters.id, tokenConfigurations.characterId))
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    if (!result) {
      // 🛡️ Sentinel: Character not found or unauthorized - throw NOT_FOUND to mask existence
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
    }

    return result.config;
  }

  /**
   * Update default token configuration for a character
   */
  static async updateDefaultTokenConfig(
    characterId: string,
    userId: string,
    config: Partial<NewTokenConfiguration>
  ): Promise<TokenConfiguration> {
    // ⚡ Bolt: Removed redundant verifyCharacterOwnership call as getDefaultTokenConfig
    // now performs this check atomically in a single database operation.
    const existing = await this.getDefaultTokenConfig(characterId, userId);

    if (existing) {
      // Update existing config
      const [updated] = await db
        .update(tokenConfigurations)
        .set({
          ...config,
          updatedAt: new Date(),
        })
        .where(eq(tokenConfigurations.id, existing.id))
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update token configuration',
        });
      }

      return updated;
    } else {
      // Create new config
      const [created] = await db
        .insert(tokenConfigurations)
        .values({
          characterId,
          ...config,
        })
        .returning();

      if (!created) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create token configuration',
        });
      }

      return created;
    }
  }

  /**
   * Apply default configuration to a token
   */
  static async applyDefaultConfig(tokenId: string, userId: string): Promise<Token | null> {
    // Get token
    const token = await this.getTokenById(tokenId, userId);
    if (!token) return null;

    // Get linked character
    if (!token.actorId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Token is not linked to a character',
      });
    }

    // Get default config
    const config = await this.getDefaultTokenConfig(token.actorId, userId);
    if (!config) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No default token configuration found for this character',
      });
    }

    // Apply config to token
    return this.updateToken(tokenId, userId, {
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
