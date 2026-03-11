/**
 * Spell Slots Service
 *
 * Handles D&D 5E spell slot calculation, tracking, and management
 * Implements PHB spell slot progression tables for all spellcasting classes
 *
 * @module server/services/spell-slots-service
 */

import { and, eq, exists, or, count, desc, inArray, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import { characters, characterSpellSlots, spellSlotUsageLog } from '../../../db/schema/index';
import { NotFoundError, ValidationError, BusinessLogicError, InternalServerError } from '../lib/errors.js';
import { SpellSlotMechanics } from './spell-slots/spell-slot-mechanics.js';

import type {
  SpellSlot,
  SpellSlotUsageLog,
  CharacterSpellSlots,
  SpellSlotCalculation,
  MulticlassSpellSlots,
  UseSpellSlotInput,
  UseSpellSlotResult,
  RestoreSpellSlotsInput,
  RestoreSpellSlotsResult,
  UpcastValidation,
  SpellSlotUsageHistory,
  SpellSlotUsageQuery,
  ClassName,
} from '../types/spell-slots.js';

/**
 * Spell Slots Service
 */
export class SpellSlotsService {
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
   * Calculate spell slots for a single class (D&D 5E PHB tables)
   * @param className - D&D 5E class name
   * @param level - Character level (1-20)
   * @returns Spell slot calculation
   */
  static calculateSpellSlots(className: ClassName, level: number): SpellSlotCalculation {
    return SpellSlotMechanics.calculateSpellSlots(className, level);
  }

  /**
   * Calculate spell slots for multiclass characters (D&D 5E PHB pg. 164-165)
   * Warlock levels are handled separately (Pact Magic doesn't combine)
   *
   * @param classes - Array of classes and levels
   * @returns Multiclass spell slot calculation
   */
  static calculateMulticlassSpellSlots(
    classes: Array<{ className: ClassName; level: number }>
  ): MulticlassSpellSlots {
    return SpellSlotMechanics.calculateMulticlassSpellSlots(classes);
  }

  /**
   * Get character's current spell slots with ownership verification
   * @param characterId - Character UUID
   * @param userId - User ID for ownership check
   * @returns Character's spell slots
   */
  static async getCharacterSpellSlots(
    characterId: string,
    userId: string,
  ): Promise<CharacterSpellSlots> {
    // ⚡ Bolt: Consolidated character ownership verification and spell slot retrieval into a single query.
    // Using a LEFT JOIN from characters ensures we can distinguish between "Character not found" (0 rows)
    // and "Character found but no spell slots" (1 row with null slot fields).
    // This reduces database round-trips from 2 to 1 for non-spellcasters.
    const results = await (db as any)
      .select({
        slot: characterSpellSlots,
        charId: characters.id,
      })
      .from(characters)
      .leftJoin(characterSpellSlots, eq(characterSpellSlots.characterId, characters.id))
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .orderBy(characterSpellSlots.spellLevel);

    if (results.length === 0) {
      throw new NotFoundError('Character', characterId);
    }

    // Filter out null slots (from characters with no spell slot records)
    const slots: SpellSlot[] = results
      .filter((r: any) => r.slot !== null)
      .map((r: any) => ({
        id: r.slot.id,
        characterId: r.slot.characterId,
        spellLevel: r.slot.spellLevel,
        totalSlots: r.slot.totalSlots,
        usedSlots: r.slot.usedSlots,
        remainingSlots: r.slot.totalSlots - r.slot.usedSlots,
        createdAt: r.slot.createdAt,
        updatedAt: r.slot.updatedAt,
      }));

    const totalAvailableSlots = slots.reduce((sum, slot) => sum + slot.remainingSlots, 0);
    const totalUsedSlots = slots.reduce((sum, slot) => sum + slot.usedSlots, 0);

    const result: CharacterSpellSlots = {
      characterId,
      slots,
      totalAvailableSlots,
      totalUsedSlots,
    };

    // Add index signature access
    for (const slot of slots) {
      result[slot.spellLevel] = slot;
    }

    return result;
  }

  /**
   * Use a spell slot with ownership verification
   * @param input - Spell slot usage input
   * @param userId - User ID for ownership check
   * @returns Result of using the spell slot
   */
  static async useSpellSlot(input: UseSpellSlotInput, userId: string): Promise<UseSpellSlotResult> {
    const { characterId, spellName, spellLevel, slotLevelUsed, sessionId } = input;

    if (userId) {
      await this.verifyCharacterOwnership(characterId, userId);
    }

    // Validate spell levels
    if (spellLevel < 0 || spellLevel > 9) {
      throw new ValidationError('Spell level must be between 0 and 9', { spellLevel });
    }

    if (slotLevelUsed < 1 || slotLevelUsed > 9) {
      throw new ValidationError('Slot level must be between 1 and 9', { slotLevelUsed });
    }

    // Check if upcasting is valid
    if (spellLevel > 0 && slotLevelUsed < spellLevel) {
      throw new ValidationError(`Cannot use a level ${slotLevelUsed} slot for a level ${spellLevel} spell`, { spellLevel, slotLevelUsed });
    }

    const wasUpcast = spellLevel > 0 && slotLevelUsed > spellLevel;

    // Get current slot state with ownership verification
    const slotData = await db.query.characterSpellSlots.findFirst({
      where: and(
        eq(characterSpellSlots.characterId, characterId),
        eq(characterSpellSlots.spellLevel, slotLevelUsed),
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

    if (!slotData) {
      throw new NotFoundError(`Level ${slotLevelUsed} spell slots for character`, characterId);
    }

    // Check if slot is available
    if (slotData.usedSlots >= slotData.totalSlots) {
      throw new BusinessLogicError(`No available level ${slotLevelUsed} spell slots`, {
        level: slotLevelUsed,
        used: slotData.usedSlots,
        total: slotData.totalSlots
      });
    }

    // 🛡️ Sentinel: Incorporate ownership check into the UPDATE query for defense-in-depth
    const [updatedSlot] = await db
      .update(characterSpellSlots)
      .set({
        usedSlots: slotData.usedSlots + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(characterSpellSlots.id, slotData.id),
          eq(characterSpellSlots.characterId, characterId),
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          )
        )
      )
      .returning();

    if (!updatedSlot) {
      throw new InternalServerError('Failed to use spell slot');
    }

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT
    const [logEntry] = await db
      .insert(spellSlotUsageLog)
      .select(
        db.select({
          characterId: sql`${characterId}`,
          sessionId: sql`${sessionId || null}`,
          spellName: sql`${spellName}`,
          spellLevel: sql`${spellLevel}`,
          slotLevelUsed: sql`${slotLevelUsed}`,
        })
        .from(characters)
        .where(and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ))
      )
      .returning();

    if (!logEntry) {
      throw new InternalServerError('Failed to log spell usage');
    }

    const slot: SpellSlot = {
      id: updatedSlot.id,
      characterId: updatedSlot.characterId,
      spellLevel: updatedSlot.spellLevel,
      totalSlots: updatedSlot.totalSlots,
      usedSlots: updatedSlot.usedSlots,
      remainingSlots: updatedSlot.totalSlots - updatedSlot.usedSlots,
      createdAt: updatedSlot.createdAt,
      updatedAt: updatedSlot.updatedAt,
    };

    const log: SpellSlotUsageLog = {
      id: logEntry.id,
      characterId: logEntry.characterId,
      sessionId: logEntry.sessionId,
      spellName: logEntry.spellName,
      spellLevel: logEntry.spellLevel,
      slotLevelUsed: logEntry.slotLevelUsed,
      timestamp: logEntry.timestamp,
    };

    const message = wasUpcast
      ? `Cast ${spellName} using a level ${slotLevelUsed} slot (upcast from level ${spellLevel})`
      : `Cast ${spellName} using a level ${slotLevelUsed} slot`;

    return {
      success: true,
      message,
      slot,
      logEntry: log,
      wasUpcast,
    };
  }

  /**
   * Check if a spell can be upcast
   * @param spellName - Name of the spell
   * @param baseLevel - Base level of the spell
   * @param targetLevel - Target level to upcast to
   * @returns Upcasting validation result
   */
  static canUpcast(spellName: string, baseLevel: number, targetLevel: number): UpcastValidation {
    return SpellSlotMechanics.canUpcast(spellName, baseLevel, targetLevel);
  }

  /**
   * Restore spell slots (long rest or specific restoration) with ownership verification
   * @param input - Restore spell slots input
   * @param userId - User ID for ownership check
   * @returns Result of restoration
   */
  static async restoreSpellSlots(
    input: RestoreSpellSlotsInput,
    userId: string,
  ): Promise<RestoreSpellSlotsResult> {
    const { characterId, level, amount } = input;

    // ⚡ Bolt: Consolidated character ownership verification and spell slot retrieval into a single query.
    // Using a LEFT JOIN from characters ensures we can verify ownership and fetch slots in one round-trip.
    const results = await (db as any)
      .select({
        slot: characterSpellSlots,
        charId: characters.id,
      })
      .from(characters)
      .leftJoin(
        characterSpellSlots,
        and(
          eq(characterSpellSlots.characterId, characters.id),
          level !== undefined ? eq(characterSpellSlots.spellLevel, level) : undefined,
        ),
      )
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      );

    if (results.length === 0) {
      throw new NotFoundError('Character', characterId);
    }

    if (level !== undefined && (level < 1 || level > 9)) {
      throw new ValidationError('Spell level must be between 1 and 9', { level });
    }

    // Filter out null slots (from characters with no spell slot records)
    const slots = results
      .map((r: any) => r.slot)
      .filter((s: any): s is SpellSlot => s !== null);

    if (!slots || slots.length === 0) {
      return {
        characterId,
        slotsRestored: [],
        totalRestored: 0,
      };
    }

    const slotsToUpdate = slots.filter(s => s.usedSlots > 0);

    if (slotsToUpdate.length === 0) {
      return {
        characterId,
        slotsRestored: [],
        totalRestored: 0,
      };
    }

    const slotsRestored = slotsToUpdate.map(slot => {
      const restoredAmount = (amount !== undefined && amount >= 0)
        ? Math.min(amount, slot.usedSlots)
        : slot.usedSlots;

      return {
        level: slot.spellLevel,
        restoredAmount,
      };
    });

    const totalRestored = slotsRestored.reduce((sum, r) => sum + r.restoredAmount, 0);

    // ⚡ Bolt: Optimized N+1 update loop into a single batch update query.
    // This reduces database round-trips from N (number of slot levels) to 1.
    // 🛡️ Sentinel: Incorporate ownership check into the batch UPDATE query for defense-in-depth
    await db
      .update(characterSpellSlots)
      .set({
        usedSlots: amount !== undefined && amount >= 0
          ? sql`GREATEST(0, ${characterSpellSlots.usedSlots} - ${amount})`
          : 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(characterSpellSlots.id, slotsToUpdate.map(s => s.id)),
          eq(characterSpellSlots.characterId, characterId),
          exists(
            db.select()
              .from(characters)
              .where(and(
                eq(characters.id, characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId))
              ))
          )
        )
      );

    return {
      characterId,
      slotsRestored,
      totalRestored,
    };
  }

  /**
   * Get spell slot usage history with ownership verification
   * @param query - Usage query parameters
   * @param userId - User ID for ownership check
   * @returns Usage history
   */
  static async getSpellSlotUsageHistory(query: SpellSlotUsageQuery, userId: string): Promise<SpellSlotUsageHistory> {
    const { characterId, sessionId, limit = 50, offset = 0 } = query;

    // Verify ownership
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    const whereClauses = [
      eq(spellSlotUsageLog.characterId, characterId),
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
      whereClauses.push(eq(spellSlotUsageLog.sessionId, sessionId));
    }

    const entriesData = await db.query.spellSlotUsageLog.findMany({
      where: and(...whereClauses),
      orderBy: [desc(spellSlotUsageLog.timestamp)],
      limit,
      offset,
    });

    const [totalResult] = await db
      .select({ value: count() })
      .from(spellSlotUsageLog)
      .where(and(...whereClauses));

    const total = totalResult?.value || 0;

    const entries: SpellSlotUsageLog[] = entriesData.map((row) => ({
      id: row.id,
      characterId: row.characterId,
      sessionId: row.sessionId,
      spellName: row.spellName,
      spellLevel: row.spellLevel,
      slotLevelUsed: row.slotLevelUsed,
      timestamp: row.timestamp,
    }));

    const hasMore = offset + entries.length < total;

    return {
      entries,
      total,
      hasMore,
    };
  }

  /**
   * Initialize spell slots for a character based on their class and level with ownership verification
   * @param characterId - Character UUID
   * @param userId - User ID for ownership check
   * @param classes - Character's classes and levels
   * @returns Initialized spell slots
   */
  static async initializeSpellSlots(
    characterId: string,
    userId: string,
    classes: Array<{ className: ClassName; level: number }>
  ): Promise<CharacterSpellSlots> {
    // Verify ownership
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    // Calculate spell slots
    const calculation =
      classes.length === 1
        ? SpellSlotMechanics.calculateSpellSlots(classes[0]?.className ?? 'Fighter', classes[0]?.level ?? 1)
        : SpellSlotMechanics.calculateMulticlassSpellSlots(classes);

    const slots = 'slots' in calculation ? calculation.slots : {};

    // 🛡️ Sentinel: Incorporate ownership check into the DELETE query for defense-in-depth
    await db.delete(characterSpellSlots).where(
      and(
        eq(characterSpellSlots.characterId, characterId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      )
    );

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth
    const insertData = Object.entries(slots).map(([level, total]) => ({
      characterId: sql`${characterId}`,
      spellLevel: sql`${parseInt(level)}`,
      totalSlots: sql`${total}`,
      usedSlots: sql`0`,
    }));

    if (insertData.length > 0) {
      // Use a single query with multiple SELECT ... WHERE EXISTS combined via UNION ALL
      // to ensure atomicity and ownership verification for each inserted row.
      const selectQueries = insertData.map(insert =>
        db.select(insert)
          .from(characters)
          .where(and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
      );

      // Join all select queries with unionAll
      let finalSelect: any = selectQueries[0];
      for (let i = 1; i < selectQueries.length; i++) {
        finalSelect = finalSelect.unionAll(selectQueries[i]);
      }

      await db.insert(characterSpellSlots).select(finalSelect);
    }

    // Return the initialized slots
    return this.getCharacterSpellSlots(characterId, userId);
  }
}
