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
import { eq, and, desc, or, exists, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
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
} from '../../../db/schema/index';

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
   * Verify user has access to a scene.
   * Returns NOT_FOUND for both missing and unauthorized scenes to avoid existence leaks.
   */
  private static async verifySceneAccess(sceneId: string, userId: string): Promise<boolean> {
    const scene = await db.query.scenes.findFirst({
      where: and(eq(scenes.id, sceneId), eq(scenes.userId, userId)),
      columns: { id: true },
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
  private static async verifyCharacterOwnership(
    characterId: string,
    userId: string,
  ): Promise<boolean> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
      columns: { id: true },
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
      .where(and(eq(tokens.sceneId, sceneId), eq(scenes.userId, userId)))
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
      .where(and(eq(tokens.id, tokenId), eq(scenes.userId, userId)))
      .limit(1);

    return result?.token || null;
  }

  /**
   * Create a new token
   */
  static async createToken(sceneId: string, userId: string, data: CreateTokenData): Promise<Token> {
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    // This ensures that tokens can only be added to scenes the user is authorized to access,
    // and if an actorId is provided, that the user owns that character.
    const [token] = await db
      .insert(tokens)
      .select(
        db
          .select({
            sceneId: sql`${sceneId}`,
            actorId: sql`${data.actorId || null}`,
            createdBy: sql`${userId}`,
            name: sql`${data.name}`,
            tokenType: sql`${data.tokenType}`,
            positionX: sql`${String(data.positionX)}`,
            positionY: sql`${String(data.positionY)}`,
            imageUrl: sql`${data.imageUrl || null}`,
            sizeWidth: sql`${data.sizeWidth ? String(data.sizeWidth) : '1.0'}`,
            sizeHeight: sql`${data.sizeHeight ? String(data.sizeHeight) : '1.0'}`,
            gridSize: sql`${data.gridSize || 'medium'}`,
            visionEnabled: sql`${data.visionEnabled || false}`,
            visionRange: sql`${data.visionRange ? String(data.visionRange) : null}`,
            emitsLight: sql`${data.emitsLight || false}`,
            lightRange: sql`${data.lightRange ? String(data.lightRange) : null}`,
            lightColor: sql`${data.lightColor || null}`,
          })
          .from(scenes)
          .where(
            and(
              eq(scenes.id, sceneId),
              eq(scenes.userId, userId),
              data.actorId
                ? exists(
                    db
                      .select()
                      .from(characters)
                      .where(
                        and(
                          eq(characters.id, data.actorId),
                          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
                        )
                      )
                  )
                : sql`true`
            )
          )
      )
      .returning();

    if (!token) {
      // 🛡️ Sentinel: Throw NOT_FOUND for unauthorized access to mask resource existence.
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Scene or character not found' });
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
    onBroadcast?: (sceneId: string, token: Token) => void,
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
      .where(
        and(
          eq(tokens.id, tokenId),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, tokens.sceneId), eq(scenes.userId, userId))),
          ),
        ),
      )
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
      .where(
        and(
          eq(tokens.id, tokenId),
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, tokens.sceneId), eq(scenes.userId, userId))),
          ),
        ),
      )
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
    onBroadcast?: (sceneId: string, token: Token) => void,
  ): Promise<Token | null> {
    return this.updateToken(
      tokenId,
      userId,
      {
        positionX: String(newX),
        positionY: String(newY),
      },
      onBroadcast,
    );
  }

  /**
   * Link a token to a character
   */
  static async linkToCharacter(
    tokenId: string,
    characterId: string,
    userId: string,
  ): Promise<boolean> {
    // ⚡ Bolt: Consolidate authorization and update into fewer round-trips.
    // We check both scene and character ownership directly in the token update.
    const [updated] = await db
      .update(tokens)
      .set({ actorId: characterId, updatedAt: new Date() })
      .where(
        and(
          eq(tokens.id, tokenId),
          // Scene ownership check
          exists(
            db
              .select()
              .from(scenes)
              .where(and(eq(scenes.id, tokens.sceneId), eq(scenes.userId, userId))),
          ),
          // Character ownership check
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
    userId: string,
  ): Promise<boolean> {
    // 🛡️ Sentinel: Refactored to incorporate ownership checks directly into queries.
    // This prevents separate check-then-act vulnerabilities and masks existence.
    // We require both scene ownership and character ownership for unlinking,
    // maintaining consistency with the linkToCharacter pattern.

    // ⚡ Bolt: Parallelize independent database operations to reduce aggregate latency.
    const [deletedResults, updatedResults] = await Promise.all([
      // Remove character-token link with atomic ownership check
      db
        .delete(characterTokens)
        .where(
          and(
            eq(characterTokens.characterId, characterId),
            eq(characterTokens.tokenId, tokenId),
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
        .returning({ characterId: characterTokens.characterId }),
      // Clear actorId with atomic ownership check
      db
        .update(tokens)
        .set({ actorId: null, updatedAt: new Date() })
        .where(
          and(
            eq(tokens.id, tokenId),
            eq(tokens.actorId, characterId),
            exists(
              db
                .select()
                .from(scenes)
                .where(and(eq(scenes.id, tokens.sceneId), eq(scenes.userId, userId))),
            ),
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
        .returning({ id: tokens.id }),
    ]);

    if (deletedResults.length === 0 || updatedResults.length === 0) {
      // 🛡️ Sentinel: Throw NOT_FOUND if either operation failed to affect rows
      // (likely due to missing ownership or record not existing).
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Token or character not found' });
    }

    return true;
  }

  /**
   * Get all tokens for a character
   */
  static async getTokensForCharacter(characterId: string, userId: string): Promise<Token[]> {
    // ⚡ Bolt: Consolidate ownership verification and token retrieval into a single joined query.
    // This reduces database round-trips from 2 to 1 and improves performance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = await (db as any)
      .select({
        token: tokens,
      })
      .from(characters)
      .leftJoin(characterTokens, eq(characters.id, characterTokens.characterId))
      .leftJoin(tokens, eq(characterTokens.tokenId, tokens.id))
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      );

    if (results.length === 0) {
      // 🛡️ Sentinel: Throw NOT_FOUND if character doesn't exist or user doesn't own it
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
    }

    // Filter out null tokens (case where character exists but has no tokens)
    return results
      .map((r: { token: Token | null }) => r.token)
      .filter((token: Token | null): token is Token => token !== null);
  }

  /**
   * Update token vision configuration
   */
  static async updateVision(
    tokenId: string,
    userId: string,
    visionConfig: TokenVisionConfig,
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
    lightConfig: TokenLightConfig,
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
          )
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
      // Create new config
      // 🛡️ Sentinel: Atomic insert with ownership check (characterId ownership)
      const [created] = await db
        .insert(tokenConfigurations)
        .select(
          db
            .select({
              characterId: characters.id,
              imageUrl: sql`${config.imageUrl ?? null}`,
              avatarUrl: sql`${config.avatarUrl ?? null}`,
              sizeWidth: sql`${config.sizeWidth ?? '1.0'}`,
              sizeHeight: sql`${config.sizeHeight ?? '1.0'}`,
              gridSize: sql`${config.gridSize ?? 'medium'}`,
              tintColor: sql`${config.tintColor ?? null}`,
              scale: sql`${config.scale ?? '1.0'}`,
              opacity: sql`${config.opacity ?? '1.0'}`,
              borderColor: sql`${config.borderColor ?? null}`,
              borderWidth: sql`${config.borderWidth ?? 2}`,
              showNameplate: sql`${config.showNameplate ?? true}`,
              nameplatePosition: sql`${config.nameplatePosition ?? 'bottom'}`,
              visionEnabled: sql`${config.visionEnabled ?? false}`,
              visionRange: sql`${config.visionRange ?? null}`,
              visionAngle: sql`${config.visionAngle ?? null}`,
              nightVision: sql`${config.nightVision ?? false}`,
              darkvisionRange: sql`${config.darkvisionRange ?? null}`,
              emitsLight: sql`${config.emitsLight ?? false}`,
              lightRange: sql`${config.lightRange ?? null}`,
              lightAngle: sql`${config.lightAngle ?? null}`,
              lightColor: sql`${config.lightColor ?? null}`,
              lightIntensity: sql`${config.lightIntensity ?? null}`,
              dimLightRange: sql`${config.dimLightRange ?? null}`,
              brightLightRange: sql`${config.brightLightRange ?? null}`,
              movementSpeed: sql`${config.movementSpeed ?? null}`,
              hasFlying: sql`${config.hasFlying ?? false}`,
              hasSwimming: sql`${config.hasSwimming ?? false}`,
            })
            .from(characters)
            .where(
              and(
                eq(characters.id, characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
              ),
            ),
        )
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
  static async applyDefaultConfig(tokenId: string, userId: string): Promise<Token | null> {
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
