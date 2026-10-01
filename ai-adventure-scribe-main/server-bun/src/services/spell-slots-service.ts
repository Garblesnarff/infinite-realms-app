/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing violations, not introduced by the
   insert-select sweep that touched this file. lint-staged fails the commit on any
   error in a staged file, so converting one statement here would otherwise require
   an unrelated cleanup in the same change. Left for a dedicated pass. */
/**
 * Spell Slots Service
 *
 * Handles D&D 5E spell slot calculation, tracking, and management
 * Implements PHB spell slot progression tables for all spellcasting classes
 *
 * @module server/services/spell-slots-service
 */

import { and, eq, exists, or, inArray, sql } from 'drizzle-orm';

import { db } from '../../../db/client';
import { characters, characterSpellSlots, spellSlotUsageLog } from '../../../db/schema/index';
import {
  NotFoundError,
  ValidationError,
  BusinessLogicError,
  InternalServerError,
} from '../lib/errors.js';
import { SpellSlotDataAccess } from './spell-slots/spell-slot-data-access.js';
import { CLASS_SPELLCASTING, SpellSlotMechanics } from './spell-slots/spell-slot-mechanics.js';

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
    classes: Array<{ className: ClassName; level: number }>,
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
    return SpellSlotDataAccess.getCharacterSpellSlots(characterId, userId);
  }

  /**
   * Use a spell slot with ownership verification
   * @param input - Spell slot usage input
   * @param userId - User ID for ownership check
   * @returns Result of using the spell slot
   */
  static async useSpellSlot(input: UseSpellSlotInput, userId: string): Promise<UseSpellSlotResult> {
    const { characterId, spellName, spellLevel, slotLevelUsed, sessionId } = input;

    // ⚡ Bolt: Removed redundant verifyCharacterOwnership call.
    // Ownership is verified atomically within the main slot retrieval query via EXISTS subquery.
    // This reduces database round-trips from 2 to 1 in the happy path.

    // Validate spell levels
    if (spellLevel < 0 || spellLevel > 9) {
      throw new ValidationError('Spell level must be between 0 and 9', { spellLevel });
    }

    if (slotLevelUsed < 1 || slotLevelUsed > 9) {
      throw new ValidationError('Slot level must be between 1 and 9', { slotLevelUsed });
    }

    // Check if upcasting is valid
    if (spellLevel > 0 && slotLevelUsed < spellLevel) {
      throw new ValidationError(
        `Cannot use a level ${slotLevelUsed} slot for a level ${spellLevel} spell`,
        { spellLevel, slotLevelUsed },
      );
    }

    const wasUpcast = spellLevel > 0 && slotLevelUsed > spellLevel;

    // Get current slot state with ownership verification
    // ⚡ Bolt: Using explicit JOIN instead of EXISTS for better visibility and slightly better performance in some DB engines.
    let [slotData] = await (db as any)
      .select({
        id: characterSpellSlots.id,
        characterId: characterSpellSlots.characterId,
        spellLevel: characterSpellSlots.spellLevel,
        totalSlots: characterSpellSlots.totalSlots,
        usedSlots: characterSpellSlots.usedSlots,
      })
      .from(characterSpellSlots)
      .innerJoin(characters, eq(characterSpellSlots.characterId, characters.id))
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, slotLevelUsed),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .limit(1);

    // The engine's slot table is the single source of truth, but characters
    // created before their rows existed (e.g. premade starter-campaign
    // characters, #2459) have none. Derive the missing rows from the real
    // class progression table instead of refusing the cast.
    if (!slotData) {
      slotData = await this.ensureSpellSlotRow(characterId, userId, slotLevelUsed);
    }

    // Check if slot is available
    if (slotData.usedSlots >= slotData.totalSlots) {
      throw new BusinessLogicError(`No available level ${slotLevelUsed} spell slots`, {
        level: slotLevelUsed,
        used: slotData.usedSlots,
        total: slotData.totalSlots,
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

    if (!updatedSlot) {
      throw new InternalServerError('Failed to use spell slot');
    }

    // The usage log's insert-select projected 5 of spell_slot_usage_log's 7 columns
    // and so never ran. Ownership is already proven: the UPDATE above carried the
    // same EXISTS check and we threw just now if it matched no row.
    const [logEntry] = await db
      .insert(spellSlotUsageLog)
      .values({
        characterId,
        sessionId: sessionId || null,
        spellName,
        spellLevel,
        slotLevelUsed,
      })
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
   * Resolve a character's class name to the class-table union, or null when the
   * stored value matches no known class.
   */
  private static normalizeClassName(raw: string | null): ClassName | null {
    const normalized = (raw ?? '').trim().toLowerCase();
    if (!normalized) return null;
    const match = (Object.keys(CLASS_SPELLCASTING) as ClassName[]).find(
      (name) => name.toLowerCase() === normalized,
    );
    return match ?? null;
  }

  /**
   * Return the slot row for a character/level, creating it from the real class
   * progression table when it is missing. Only missing levels are inserted;
   * existing rows (and their used counts) are never touched. When the class
   * grants no slots at that level, throws a BusinessLogicError naming the
   * cause instead of the generic "not found" refusal (#2459).
   */
  private static async ensureSpellSlotRow(
    characterId: string,
    userId: string,
    slotLevelUsed: number,
  ): Promise<Pick<SpellSlot, 'id' | 'characterId' | 'spellLevel' | 'totalSlots' | 'usedSlots'>> {
    const [character] = await db
      .select({
        name: characters.name,
        class: characters.class,
        level: characters.level,
        classLevels: characters.classLevels,
      })
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .limit(1);

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    const level = character.level && character.level > 0 ? character.level : 1;
    const fail = (reason: string): never => {
      throw new BusinessLogicError(
        `${character.name || 'Character'} has no level ${slotLevelUsed} spell slots (${reason})`,
        { characterId, class: character.class, level, slotLevelUsed },
      );
    };

    const className =
      this.normalizeClassName(character.class) ??
      fail(`unrecognized class "${character.class ?? 'unknown'}"`);

    // Multiclass characters use the PHB combined progression, not the
    // single-class table at total level (a Wizard 1 / Fighter 1 is caster
    // level 1, not Wizard 2).
    const classLevels = Array.isArray(character.classLevels)
      ? character.classLevels
          .map((entry) => {
            const raw = entry as { className?: unknown; level?: unknown };
            const name =
              typeof raw.className === 'string' ? this.normalizeClassName(raw.className) : null;
            const entryLevel = typeof raw.level === 'number' && raw.level > 0 ? raw.level : 0;
            return name && entryLevel > 0 ? { className: name, level: entryLevel } : null;
          })
          .filter((entry): entry is { className: ClassName; level: number } => entry !== null)
      : [];
    const multiclass = classLevels.length > 1;

    // Warlocks resolve here but their class table grants no slots: pact magic
    // is tracked separately, so the refusal below names that cause.
    const calculation = multiclass
      ? SpellSlotMechanics.calculateMulticlassSpellSlots(classLevels)
      : SpellSlotMechanics.calculateSpellSlots(className, level);
    const granted = calculation.slots[slotLevelUsed] ?? 0;
    if (granted <= 0) {
      fail(
        multiclass
          ? `multiclass caster level grants no level ${slotLevelUsed} spell slots`
          : `${className} ${level} grants no level ${slotLevelUsed} spell slots`,
      );
    }

    const existing = await db
      .select({ spellLevel: characterSpellSlots.spellLevel })
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
    const existingLevels = new Set(existing.map((row) => row.spellLevel));
    const toInsert = Object.entries(calculation.slots)
      .filter(([slotLevel, total]) => total > 0 && !existingLevels.has(Number(slotLevel)))
      .map(([slotLevel, total]) => ({
        characterId,
        spellLevel: Number(slotLevel),
        totalSlots: total,
        usedSlots: 0,
      }));
    if (toInsert.length > 0) {
      await db
        .insert(characterSpellSlots)
        .values(toInsert)
        .onConflictDoNothing({
          target: [characterSpellSlots.characterId, characterSpellSlots.spellLevel],
        });
    }

    const [row] = await db
      .select({
        id: characterSpellSlots.id,
        characterId: characterSpellSlots.characterId,
        spellLevel: characterSpellSlots.spellLevel,
        totalSlots: characterSpellSlots.totalSlots,
        usedSlots: characterSpellSlots.usedSlots,
      })
      .from(characterSpellSlots)
      .where(
        and(
          eq(characterSpellSlots.characterId, characterId),
          eq(characterSpellSlots.spellLevel, slotLevelUsed),
        ),
      )
      .limit(1);

    if (!row) {
      throw new InternalServerError('Failed to initialize spell slots');
    }
    return row;
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
    type RestorableSlot = Pick<
      SpellSlot,
      'id' | 'characterId' | 'spellLevel' | 'totalSlots' | 'usedSlots'
    >;
    type RestoreSlotRow = { slot: RestorableSlot | null; charId: string };
    const results: RestoreSlotRow[] = await (db as any)
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
      .map((r) => r.slot)
      .filter((slot): slot is RestorableSlot => slot !== null);

    if (!slots || slots.length === 0) {
      return {
        characterId,
        slotsRestored: [],
        totalRestored: 0,
      };
    }

    const slotsToUpdate = slots.filter((s) => s.usedSlots > 0);

    if (slotsToUpdate.length === 0) {
      return {
        characterId,
        slotsRestored: [],
        totalRestored: 0,
      };
    }

    const slotsRestored = slotsToUpdate.map((slot) => {
      const restoredAmount =
        amount !== undefined && amount >= 0 ? Math.min(amount, slot.usedSlots) : slot.usedSlots;

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
        usedSlots:
          amount !== undefined && amount >= 0
            ? sql`GREATEST(0, ${characterSpellSlots.usedSlots} - ${amount})`
            : 0,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(
            characterSpellSlots.id,
            slotsToUpdate.map((s) => s.id),
          ),
          eq(characterSpellSlots.characterId, characterId),
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
  static async getSpellSlotUsageHistory(
    query: SpellSlotUsageQuery,
    userId: string,
  ): Promise<SpellSlotUsageHistory> {
    return SpellSlotDataAccess.getSpellSlotUsageHistory(query, userId);
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
    classes: Array<{ className: ClassName; level: number }>,
  ): Promise<CharacterSpellSlots> {
    return SpellSlotDataAccess.initializeSpellSlots(characterId, userId, classes);
  }
}
