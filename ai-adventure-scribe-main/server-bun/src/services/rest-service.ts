/**
 * Rest Service
 *
 * Implements D&D 5E rest mechanics including short rests, long rests, and hit dice management.
 * Follows PHB pg. 186 rules for resting and recovery.
 *
 * @module server/services/rest-service
 */

/* eslint-disable max-lines */
import { and, desc, eq, exists, inArray, or, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import {
  characterHitDice,
  characterStats,
  characters,
  restEvents,
  type Character,
  type CharacterHitDice,
  type CharacterStats,
  type RestEvent,
} from '../../../db/schema/index';
import { BusinessLogicError, NotFoundError, ValidationError } from '../lib/errors.js';
import { RestMechanics } from './rest/rest-mechanics.js';

import type {
  HitDieType,
  LongRestResult,
  RestorableResource,
  RestType,
  ShortRestResult,
  SpendHitDiceResult,
} from '../types/rest.js';

/**
 * Rest Service
 */
export class RestService {
  /**
   * Calculate Constitution modifier from ability score
   */
  private static calculateConModifier(constitution: number): number {
    return RestMechanics.calculateConModifier(constitution);
  }

  /**
   * Roll a hit die
   */
  private static rollHitDie(dieType: HitDieType): number {
    return RestMechanics.rollHitDie(dieType);
  }

  /**
   * Get hit die type for a class
   */
  static getHitDieType(className: string): HitDieType {
    return RestMechanics.getHitDieType(className);
  }

  /**
   * Verify user owns character (direct owner or shared owner field).
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

    const conModifier = this.calculateConModifier(character.stats.constitution);
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
    // This eliminates the N+1 update pattern for multiclass characters.
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
    // This eliminates the N+1 update pattern for multiclass characters.
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
   * Get restorable resources for a rest type
   */
  static async getRestorableResources(
    characterId: string,
    userId: string,
    restType: RestType,
    preVerified: boolean = false
  ): Promise<RestorableResource[]> {
    if (!preVerified) {
      await this.verifyCharacterOwnership(characterId, userId);
    }

    // Delegated to RestMechanics
    return RestMechanics.getRestorableResources(restType);
  }

  /**
   * Take a short rest
   * PHB pg. 186: 1 hour rest, can spend hit dice to recover HP
   */
  static async takeShortRest(
    characterId: string,
    userId: string,
    hitDiceToSpend: number = 0,
    sessionId?: string,
    notes?: string
  ): Promise<ShortRestResult> {
    // ⚡ Bolt: Consolidated character ownership verification, stats fetching, and hit dice retrieval
    // into a single database round-trip. This reduces sequential latency from 3-4 down to 1.
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
      with: {
        stats: true,
        hitDice: true,
      },
    }) as (Character & { stats: CharacterStats | null; hitDice: CharacterHitDice[] }) | undefined;

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    const hitDice = character.hitDice || [];

    // Spend hit dice if requested
    let hpRestored = 0;
    let hitDiceSpent = 0;
    let updatedHitDice = hitDice;

    if (hitDiceToSpend > 0) {
      const result = await this.spendHitDice(characterId, userId, hitDiceToSpend, undefined, {
        character,
        hitDice,
      });
      hpRestored = result.hpRestored;
      hitDiceSpent = result.hitDiceSpent;
      updatedHitDice = result.hitDiceRemaining;
    }

    // Get restorable resources
    const resourcesRestored = await this.getRestorableResources(characterId, userId, 'short', true);

    // Create rest event
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [restEvent] = await db
      .insert(restEvents)
      .select(
        db.select({
          characterId: sql`${characterId}`,
          sessionId: sql`${sessionId || null}`,
          restType: sql`'short'`,
          startedAt: sql`NOW()`,
          completedAt: sql`NOW()`,
          hpRestored: sql`${hpRestored}`,
          hitDiceSpent: sql`${hitDiceSpent}`,
          resourcesRestored: sql`${JSON.stringify(resourcesRestored)}`,
          interrupted: sql`false`,
          notes: sql`${notes || null}`,
        })
        .from(characters)
        .where(and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ))
      )
      .returning();

    if (!restEvent) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character', characterId);
    }

    return {
      characterId,
      restType: 'short',
      hpRestored,
      hitDiceSpent,
      hitDiceRemaining: updatedHitDice,
      resourcesRestored,
      restEventId: restEvent.id,
    };
  }

  /**
   * Take a long rest
   * PHB pg. 186: 8 hours rest, restore all HP, spell slots, and half hit dice
   */
  static async takeLongRest(
    characterId: string,
    userId: string,
    sessionId?: string,
    notes?: string
  ): Promise<LongRestResult> {
    // ⚡ Bolt: Consolidated character ownership verification, stats fetching, and hit dice retrieval
    // into a single database round-trip. This reduces sequential latency from 3-4 down to 1.
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
      with: {
        stats: true,
        hitDice: true,
      },
    }) as (Character & { stats: CharacterStats | null; hitDice: CharacterHitDice[] }) | undefined;

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    const hitDice = character.hitDice || [];

    // Note: HP restoration would be handled by updating character's current HP
    // This is a placeholder that calculates the theoretical HP restored
    // In a full implementation, this would integrate with HP tracking system
    const hpRestored = 0; // Would be: maxHP - currentHP

    // Restore hit dice (half total, minimum 1)
    const { restoredCount: hitDiceRestored, updatedHitDice } = await this.restoreHitDice(characterId, userId, undefined, hitDice);

    // Get restorable resources
    const resourcesRestored = await this.getRestorableResources(characterId, userId, 'long', true);

    // Create rest event
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    const [restEvent] = await db
      .insert(restEvents)
      .select(
        db.select({
          characterId: sql`${characterId}`,
          sessionId: sql`${sessionId || null}`,
          restType: sql`'long'`,
          startedAt: sql`NOW()`,
          completedAt: sql`NOW()`,
          hpRestored: sql`${hpRestored}`,
          hitDiceSpent: sql`0`,
          resourcesRestored: sql`${JSON.stringify(resourcesRestored)}`,
          interrupted: sql`false`,
          notes: sql`${notes || null}`,
        })
        .from(characters)
        .where(and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ))
      )
      .returning();

    if (!restEvent) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Character', characterId);
    }

    return {
      characterId,
      restType: 'long',
      hpRestored,
      hitDiceRestored,
      hitDiceRemaining: updatedHitDice,
      resourcesRestored,
      restEventId: restEvent.id,
    };
  }

  /**
   * Get rest history for a character
   */
  static async getRestHistory(
    characterId: string,
    userId: string,
    sessionId?: string,
    limit: number = 50
  ): Promise<RestEvent[]> {
    const conditions = [
      eq(restEvents.characterId, characterId),
      exists(
        db.select()
          .from(characters)
          .where(and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
      )
    ];

    if (sessionId) {
      conditions.push(eq(restEvents.sessionId, sessionId));
    }

    const history = await db.query.restEvents.findMany({
      where: and(...conditions),
      orderBy: [desc(restEvents.startedAt)],
      limit,
    });

    return history;
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
