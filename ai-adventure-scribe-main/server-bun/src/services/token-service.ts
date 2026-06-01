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

import {
  TokenConfigService,
  type TokenVisionConfig,
  type TokenLightConfig,
} from './token/token-config-service';
import { TokenLinkService } from './token/token-link-service';
import { db } from '../../../db/client';
import {
  tokens,
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

export type { TokenVisionConfig, TokenLightConfig };

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
   * @deprecated Use TokenLinkService.verifyCharacterOwnership directly
   */
  private static async verifyCharacterOwnership(
    characterId: string,
    userId: string,
  ): Promise<boolean> {
    return TokenLinkService.verifyCharacterOwnership(characterId, userId);
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
                      .select({ one: sql`1` })
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
  public static async updateToken(
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
              .select({ one: sql`1` })
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
              .select({ one: sql`1` })
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
    return TokenLinkService.linkToCharacter(tokenId, characterId, userId);
  }

  /**
   * Unlink a token from a character
   */
  static async unlinkFromCharacter(
    tokenId: string,
    characterId: string,
    userId: string,
  ): Promise<boolean> {
    return TokenLinkService.unlinkFromCharacter(tokenId, characterId, userId);
  }

  /**
   * Get all tokens for a character
   */
  static async getTokensForCharacter(characterId: string, userId: string): Promise<Token[]> {
    return TokenLinkService.getTokensForCharacter(characterId, userId);
  }

  /**
   * Update token vision configuration
   * @deprecated Use TokenConfigService.updateVision directly
   */
  static async updateVision(
    tokenId: string,
    userId: string,
    visionConfig: TokenVisionConfig,
  ): Promise<Token | null> {
    return TokenConfigService.updateVision(tokenId, userId, visionConfig, TokenService);
  }

  /**
   * Update token light configuration
   * @deprecated Use TokenConfigService.updateLight directly
   */
  static async updateLight(
    tokenId: string,
    userId: string,
    lightConfig: TokenLightConfig,
  ): Promise<Token | null> {
    return TokenConfigService.updateLight(tokenId, userId, lightConfig, TokenService);
  }

  /**
   * Get default token configuration for a character
   * @deprecated Use TokenConfigService.getDefaultTokenConfig directly
   */
  static async getDefaultTokenConfig(
    characterId: string,
    userId: string,
  ): Promise<TokenConfiguration | null> {
    return TokenConfigService.getDefaultTokenConfig(characterId, userId);
  }

  /**
   * Update default token configuration for a character
   * @deprecated Use TokenConfigService.updateDefaultTokenConfig directly
   */
  static async updateDefaultTokenConfig(
    characterId: string,
    userId: string,
    config: Partial<NewTokenConfiguration>,
  ): Promise<TokenConfiguration> {
    return TokenConfigService.updateDefaultTokenConfig(characterId, userId, config);
  }

  /**
   * Apply default configuration to a token
   * @deprecated Use TokenConfigService.applyDefaultConfig directly
   */
  static async applyDefaultConfig(tokenId: string, userId: string): Promise<Token | null> {
    return TokenConfigService.applyDefaultConfig(tokenId, userId, TokenService);
  }
}
