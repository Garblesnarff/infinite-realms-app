/**
 * Rest Hit Dice Service
 *
 * Handles hit dice management for D&D 5E rest mechanics.
 * Extracted from RestService to improve modularity.
 *
 * @module server-bun/services/rest/rest-hit-dice-service
 */

import { and, eq, exists, inArray, or, sql } from 'drizzle-orm';

import { RestMechanics } from './rest-mechanics.js';
import { db } from '../../../../db/client';
import {
  characterHitDice,
  characters,
  type Character,
  type CharacterHitDice,
  type CharacterStats,
} from '../../../../db/schema/index';
import { BusinessLogicError, NotFoundError, ValidationError } from '../../lib/errors.js';

import type {
  HitDieType,
  SpendHitDiceResult,
} from '../../types/rest.js';

/**
 * Rest Hit Dice Service
 */
export class RestHitDiceService {
  /**
   * Verify user owns character (direct owner or shared owner field).
   * Throws NOT_FOUND to avoid disclosing character existence.
   */
  static async verifyCharacterOwnership(characterId: string, userId: string): Promise<void> {
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
   * Get hit die type for a class
   */
  static getHitDieType(className: string): HitDieType {
    return RestMechanics.getHitDieType(className);
  }

  /**
   * Initialize hit dice for a character based on their class and level
   */
  static async initializeHitDice(
    characterId: string,
    userId: string,
    className: string,
    level: number
  ): Promise<CharacterHitDice> {
    await this.verifyCharacterOwnership(characterId, userId);

    const dieType = this.getHitDieType(className);

    // Check if hit dice already exist for this character/class
    const existing = await db.query.characterHitDice.findFirst({
      where: and(
        eq(characterHitDice.characterId, characterId),
        eq(characterHitDice.className, className),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ),
    });

    if (existing) {
      // Update total dice to match level
      const [updated] = await db
        .update(characterHitDice)
        .set({
          totalDice: level,
          updatedAt: new Date(),
        })
        .where(and(
          eq(characterHitDice.id, existing.id),
          eq(characterHitDice.characterId, characterId),
          eq(characterHitDice.className, className),
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, characterHitDice.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          )
        ))
        .returning();

      if (!updated) {
        // 🛡️ Sentinel: Throw NotFoundError for unauthorized access or missing record to mask existence.
        throw new NotFoundError('Character hit dice', characterId);
      }

      return updated;
    }

    // Create new hit dice record
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [hitDice] = await db
      .insert(characterHitDice)
      .select(
        db.select({
          characterId: sql`${characterId}`,
          className: sql`${className}`,
          dieType: sql`${dieType}`,
          totalDice: sql`${level}`,
          usedDice: sql`0`,
        })
        .from(characters)
        .where(and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ))
      )
      .returning();

    if (!hitDice) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character', characterId);
    }

    return hitDice;
  }

  /**
   * Get all hit dice for a character
   */
  static async getHitDice(characterId: string, userId: string): Promise<CharacterHitDice[]> {
    const hitDice = await db.query.characterHitDice.findMany({
      where: and(
        eq(characterHitDice.characterId, characterId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ),
    });

    return hitDice;
  }

  /**
   * Get available (unspent) hit dice count
   */
  static async getAvailableHitDiceCount(characterId: string, userId: string): Promise<number> {
    const allHitDice = await this.getHitDice(characterId, userId);
    return allHitDice.reduce((sum, hd) => sum + (hd.totalDice - hd.usedDice), 0);
  }

  /**
   * Spend hit dice to recover HP
   * PHB pg. 186: Roll hit die + CON modifier (minimum 1 HP per die)
   */
  static async spendHitDice(
    characterId: string,
    userId: string,
    count: number,
    preRolledValues?: number[],
    preFetchedData?: {
      character: Character & { stats: CharacterStats | null };
      hitDice: CharacterHitDice[]
    }
  ): Promise<SpendHitDiceResult> {
    if (!preFetchedData) {
      await this.verifyCharacterOwnership(characterId, userId);
    }

    if (count < 0) {
      throw new ValidationError('Cannot spend negative hit dice', { count });
    }

    // Get character and stats
    const character = preFetchedData?.character || await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
      with: {
        stats: true,
      },
    }) as (Character & { stats: CharacterStats | null }) | undefined;

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    if (!character.stats) {
      throw new BusinessLogicError('Character has no stats', { characterId });
    }

    // Get all hit dice
    const allHitDice = preFetchedData?.hitDice || await this.getHitDice(characterId, userId);

    if (count === 0) {
      return {
        hpRestored: 0,
        hitDiceSpent: 0,
        rolls: [],
        hitDiceRemaining: allHitDice,
      };
    }

    const conModifier = RestMechanics.calculateConModifier(character.stats.constitution);
    const availableCount = allHitDice.reduce(
      (sum, hd) => sum + (hd.totalDice - hd.usedDice),
      0
    );

    if (count > availableCount) {
      throw new BusinessLogicError(
        `Cannot spend ${count} hit dice. Only ${availableCount} available.`,
        { requested: count, available: availableCount }
      );
    }

    // Spend hit dice (delegated to RestMechanics)
    const { hpRestored, rolls, updates } = RestMechanics.calculateSpentHitDice(
      count,
      conModifier,
      allHitDice,
      preRolledValues
    );

    // ⚡ Bolt: Batch update hit dice usage in a single query instead of N updates.
    if (updates.length > 0) {
      const caseStatements = updates.map((u) => sql`WHEN ${u.id} THEN ${u.newUsedDice}`);

      await db
        .update(characterHitDice)
        .set({
          usedDice: sql`CASE ${characterHitDice.id} ${sql.join(caseStatements, sql` `)} END`,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(
              characterHitDice.id,
              updates.map((u) => u.id),
            ),
            eq(characterHitDice.characterId, characterId),
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
    }

    // ⚡ Bolt: Return the updated state computed in-memory to avoid a final "refresh" round-trip.
    const finalHitDice = allHitDice.map(hd => {
      const update = updates.find(u => u.id === hd.id);
      return update ? { ...hd, usedDice: update.newUsedDice } : hd;
    });

    return {
      hpRestored,
      hitDiceSpent: count,
      rolls,
      hitDiceRemaining: finalHitDice,
    };
  }

  /**
   * Restore hit dice (used during long rest)
   * PHB pg. 186: Restore up to half total hit dice (minimum 1)
   */
  static async restoreHitDice(
    characterId: string,
    userId: string,
    count?: number,
    preFetchedHitDice?: CharacterHitDice[]
  ): Promise<{ restoredCount: number; updatedHitDice: CharacterHitDice[] }> {
    const allHitDice = preFetchedHitDice || await this.getHitDice(characterId, userId);

    if (allHitDice.length === 0) {
      return { restoredCount: 0, updatedHitDice: [] };
    }

    // Calculate hit dice to restore (delegated to RestMechanics)
    const { restoredCount, updates } = RestMechanics.calculateRestoredHitDice(
      allHitDice,
      count
    );

    if (restoredCount === 0) {
      return { restoredCount: 0, updatedHitDice: allHitDice };
    }

    // ⚡ Bolt: Batch update hit dice restoration in a single query instead of N updates.
    if (updates.length > 0) {
      const caseStatements = updates.map((u) => sql`WHEN ${u.id} THEN ${u.newUsedDice}`);

      await db
        .update(characterHitDice)
        .set({
          usedDice: sql`CASE ${characterHitDice.id} ${sql.join(caseStatements, sql` `)} END`,
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(
              characterHitDice.id,
              updates.map((u) => u.id),
            ),
            eq(characterHitDice.characterId, characterId),
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
    }

    // ⚡ Bolt: Return the updated state computed in-memory to avoid a final "refresh" round-trip.
    const finalHitDice = allHitDice.map(hd => {
      const update = updates.find(u => u.id === hd.id);
      return update ? { ...hd, usedDice: update.newUsedDice } : hd;
    });

    return { restoredCount, updatedHitDice: finalHitDice };
  }

  /**
   * Calculate hit dice for a class at a given level
   */
  static calculateHitDiceForClass(className: string, level: number): {
    dieType: HitDieType;
    count: number;
  } {
    return RestMechanics.calculateHitDiceForClass(className, level);
  }
}
