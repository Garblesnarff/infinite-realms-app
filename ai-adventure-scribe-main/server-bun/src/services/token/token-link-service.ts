import { TRPCError } from '@trpc/server';
import { eq, and, or, exists, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  tokens,
  characterTokens,
  characters,
  scenes,
  type Token,
} from '../../../../db/schema/index';

/**
 * Token Link Service
 *
 * Handles character-token linking operations.
 *
 * @module server/services/token/token-link-service
 */
export class TokenLinkService {
  /**
   * Verify user owns a character
   */
  public static async verifyCharacterOwnership(
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
              .select({ one: sql`1` })
              .from(scenes)
              .where(and(eq(scenes.id, tokens.sceneId), eq(scenes.userId, userId))),
          ),
          // Character ownership check
          exists(
            db
              .select({ one: sql`1` })
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
                .select({ one: sql`1` })
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
                .select({ one: sql`1` })
                .from(scenes)
                .where(and(eq(scenes.id, tokens.sceneId), eq(scenes.userId, userId))),
            ),
            exists(
              db
                .select({ one: sql`1` })
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
}
