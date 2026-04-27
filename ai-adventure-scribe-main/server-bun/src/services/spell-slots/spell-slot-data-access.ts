/**
 * Spell Slot Data Access
 *
 * Handles database operations for spell slots, including retrieval,
 * ownership verification, and history management.
 *
 * @module server/services/spell-slots/spell-slot-data-access
 */

import { and, eq, exists, or, desc, sql } from 'drizzle-orm';

import { SpellSlotMechanics } from './spell-slot-mechanics.js';
import { db } from '../../../../db/client';
import { characters, characterSpellSlots, spellSlotUsageLog } from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';

import type {
  SpellSlot,
  SpellSlotUsageLog,
  CharacterSpellSlots,
  SpellSlotUsageHistory,
  SpellSlotUsageQuery,
  ClassName,
} from '../../types/spell-slots.js';

/**
 * Spell Slot Data Access Class
 */
export class SpellSlotDataAccess {
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
   * Get character's current spell slots with ownership verification
   */
  static async getCharacterSpellSlots(
    characterId: string,
    userId: string,
  ): Promise<CharacterSpellSlots> {
    // ⚡ Bolt: Consolidated character ownership verification and spell slot retrieval into a single query.
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
   * Get spell slot usage history with ownership verification
   */
  static async getSpellSlotUsageHistory(query: SpellSlotUsageQuery, userId: string): Promise<SpellSlotUsageHistory> {
    const { characterId, sessionId, limit = 50, offset = 0 } = query;

    // ⚡ Bolt: Consolidated character ownership verification, usage log retrieval, and total count calculation
    // into a single query using an innerJoin and PostgreSQL window function count(*) OVER().
    const results = await (db as any)
      .select({
        log: spellSlotUsageLog,
        totalCount: sql<number>`count(*)::int OVER()`,
      })
      .from(spellSlotUsageLog)
      .innerJoin(characters, eq(spellSlotUsageLog.characterId, characters.id))
      .where(and(
        eq(spellSlotUsageLog.characterId, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        sessionId ? eq(spellSlotUsageLog.sessionId, sessionId) : undefined
      ))
      .orderBy(desc(spellSlotUsageLog.timestamp))
      .limit(limit)
      .offset(offset);

    if (results.length === 0) {
      // 🛡️ Sentinel: Verify ownership separately if results are empty to maintain standard error behavior (masking)
      await this.verifyCharacterOwnership(characterId, userId);

      return {
        entries: [],
        total: 0,
        hasMore: false,
      };
    }

    const total = results[0]?.totalCount || 0;
    const entries: SpellSlotUsageLog[] = results.map((r: any) => r.log);
    const hasMore = offset + entries.length < total;

    return {
      entries,
      total,
      hasMore,
    };
  }

  /**
   * Initialize spell slots for a character based on their class and level with ownership verification
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
