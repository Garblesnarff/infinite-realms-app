/**
 * Spell Slots Service
 *
 * Handles D&D 5E spell slot calculation, tracking, and management
 * Implements PHB spell slot progression tables for all spellcasting classes
 *
 * @module server/services/spell-slots-service
 */

import { and, eq, exists, or, count, desc } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { characters, characterSpellSlots, spellSlotUsageLog } from '../../../db/schema/index.js';
import { NotFoundError, ValidationError, BusinessLogicError, InternalServerError } from '../lib/errors.js';
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
  ClassSpellcasting,
  WarlockPactMagic,
} from '../types/spell-slots.js';

/**
 * D&D 5E Full Caster Spell Slot Progression (PHB pg. 114)
 * Used by: Wizard, Sorcerer, Cleric, Druid, Bard
 */
const FULL_CASTER_SLOTS: Record<number, number[]> = {
  1: [2, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [3, 0, 0, 0, 0, 0, 0, 0, 0],
  3: [4, 2, 0, 0, 0, 0, 0, 0, 0],
  4: [4, 3, 0, 0, 0, 0, 0, 0, 0],
  5: [4, 3, 2, 0, 0, 0, 0, 0, 0],
  6: [4, 3, 3, 0, 0, 0, 0, 0, 0],
  7: [4, 3, 3, 1, 0, 0, 0, 0, 0],
  8: [4, 3, 3, 2, 0, 0, 0, 0, 0],
  9: [4, 3, 3, 3, 1, 0, 0, 0, 0],
  10: [4, 3, 3, 3, 2, 0, 0, 0, 0],
  11: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  12: [4, 3, 3, 3, 2, 1, 0, 0, 0],
  13: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  14: [4, 3, 3, 3, 2, 1, 1, 0, 0],
  15: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  16: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

/**
 * D&D 5E Warlock Pact Magic Progression (PHB pg. 107)
 * Warlocks use a different system - all slots are the same level
 */
const WARLOCK_PACT_MAGIC: Record<number, { slots: number; level: number }> = {
  1: { slots: 1, level: 1 },
  2: { slots: 2, level: 1 },
  3: { slots: 2, level: 2 },
  4: { slots: 2, level: 2 },
  5: { slots: 2, level: 3 },
  6: { slots: 2, level: 3 },
  7: { slots: 2, level: 4 },
  8: { slots: 2, level: 4 },
  9: { slots: 2, level: 5 },
  10: { slots: 2, level: 5 },
  11: { slots: 3, level: 5 },
  12: { slots: 3, level: 5 },
  13: { slots: 3, level: 5 },
  14: { slots: 3, level: 5 },
  15: { slots: 3, level: 5 },
  16: { slots: 3, level: 5 },
  17: { slots: 4, level: 5 },
  18: { slots: 4, level: 5 },
  19: { slots: 4, level: 5 },
  20: { slots: 4, level: 5 },
};

/**
 * Class spellcasting configuration
 */
const CLASS_SPELLCASTING: Record<ClassName, ClassSpellcasting> = {
  // Full casters
  Wizard: { className: 'Wizard', casterType: 'full', spellcastingAbility: 'intelligence', spellsKnownOrPrepared: 'prepared' },
  Sorcerer: { className: 'Sorcerer', casterType: 'full', spellcastingAbility: 'charisma', spellsKnownOrPrepared: 'known' },
  Cleric: { className: 'Cleric', casterType: 'full', spellcastingAbility: 'wisdom', spellsKnownOrPrepared: 'prepared' },
  Druid: { className: 'Druid', casterType: 'full', spellcastingAbility: 'wisdom', spellsKnownOrPrepared: 'prepared' },
  Bard: { className: 'Bard', casterType: 'full', spellcastingAbility: 'charisma', spellsKnownOrPrepared: 'known' },

  // Half casters (start at level 2)
  Paladin: { className: 'Paladin', casterType: 'half', spellcastingAbility: 'charisma', spellsKnownOrPrepared: 'prepared' },
  Ranger: { className: 'Ranger', casterType: 'half', spellcastingAbility: 'wisdom', spellsKnownOrPrepared: 'known' },

  // Third casters (subclass features)
  'Eldritch Knight': { className: 'Eldritch Knight', casterType: 'third', spellcastingAbility: 'intelligence', spellsKnownOrPrepared: 'known' },
  'Arcane Trickster': { className: 'Arcane Trickster', casterType: 'third', spellcastingAbility: 'intelligence', spellsKnownOrPrepared: 'known' },

  // Pact magic
  Warlock: { className: 'Warlock', casterType: 'pact', spellcastingAbility: 'charisma', spellsKnownOrPrepared: 'known' },

  // Non-casters
  Fighter: { className: 'Fighter', casterType: 'none', spellcastingAbility: null, spellsKnownOrPrepared: null },
  Rogue: { className: 'Rogue', casterType: 'none', spellcastingAbility: null, spellsKnownOrPrepared: null },
  Barbarian: { className: 'Barbarian', casterType: 'none', spellcastingAbility: null, spellsKnownOrPrepared: null },
  Monk: { className: 'Monk', casterType: 'none', spellcastingAbility: null, spellsKnownOrPrepared: null },
};

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
    if (level < 1 || level > 20) {
      throw new ValidationError('Level must be between 1 and 20', { level });
    }

    const classInfo = CLASS_SPELLCASTING[className];
    if (!classInfo) {
      throw new ValidationError(`Unknown class: ${className}`, { className });
    }

    const casterType = classInfo.casterType;
    const slots: Record<number, number> = {};

    // Calculate effective caster level based on caster type
    let casterLevel = 0;

    if (casterType === 'full') {
      casterLevel = level;
    } else if (casterType === 'half') {
      // Half casters start at level 2, use half level rounded down
      casterLevel = Math.floor(level / 2);
    } else if (casterType === 'third') {
      // Third casters use third level rounded down, max 4th level slots
      casterLevel = Math.floor(level / 3);
    } else if (casterType === 'pact') {
      // Warlock uses Pact Magic - separate system
      return {
        className,
        level,
        slots: {}, // Handled separately
        casterType: 'pact',
        casterLevel: level,
      };
    } else {
      // Non-casters
      return {
        className,
        level,
        slots: {},
        casterType: 'none',
        casterLevel: 0,
      };
    }

    // Get spell slots from table
    if (casterLevel > 0 && casterLevel <= 20) {
      const slotArray = FULL_CASTER_SLOTS[casterLevel];
      if (slotArray) {
        for (let i = 0; i < slotArray.length; i++) {
          const spellLevel = i + 1;
          const slotCount = slotArray[i];

          // Third casters max out at 4th level spells
          if (casterType === 'third' && spellLevel > 4) {
            break;
          }

          if (slotCount !== undefined && slotCount > 0) {
            slots[spellLevel] = slotCount;
          }
        }
      }
    }

    return {
      className,
      level,
      slots,
      casterType,
      casterLevel,
    };
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
    let totalCasterLevel = 0;
    let warlockLevel = 0;

    // Calculate effective caster level (PHB pg. 164)
    for (const classInfo of classes) {
      const config = CLASS_SPELLCASTING[classInfo.className];

      if (config.casterType === 'full') {
        totalCasterLevel += classInfo.level;
      } else if (config.casterType === 'half') {
        totalCasterLevel += Math.floor(classInfo.level / 2);
      } else if (config.casterType === 'third') {
        totalCasterLevel += Math.floor(classInfo.level / 3);
      } else if (config.casterType === 'pact') {
        // Warlock doesn't combine with other spellcasting
        warlockLevel = classInfo.level;
      }
    }

    // Round down total caster level and cap at 20
    totalCasterLevel = Math.min(Math.floor(totalCasterLevel), 20);

    // Get spell slots from full caster table
    const slots: Record<number, number> = {};
    if (totalCasterLevel > 0) {
      const slotArray = FULL_CASTER_SLOTS[totalCasterLevel];
      if (slotArray) {
        for (let i = 0; i < slotArray.length; i++) {
          const spellLevel = i + 1;
          const slotCount = slotArray[i];
          if (slotCount !== undefined && slotCount > 0) {
            slots[spellLevel] = slotCount;
          }
        }
      }
    }

    // Handle Warlock Pact Magic separately
    let warlockSlots: WarlockPactMagic | undefined;
    if (warlockLevel > 0) {
      const pactMagic = WARLOCK_PACT_MAGIC[warlockLevel];
      if (pactMagic) {
        warlockSlots = {
          slots: pactMagic.slots,
          level: pactMagic.level,
          warlockLevel,
        };
      }
    }

    return {
      classes,
      totalCasterLevel,
      slots,
      warlockSlots,
    };
  }

  /**
   * Get character's current spell slots with ownership verification
   * @param characterId - Character UUID
   * @param userId - User ID for ownership check
   * @returns Character's spell slots
   */
  static async getCharacterSpellSlots(characterId: string, userId: string): Promise<CharacterSpellSlots> {
    const data = await db.query.characterSpellSlots.findMany({
      where: and(
        eq(characterSpellSlots.characterId, characterId),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId))
            ))
        )
      ),
      orderBy: [characterSpellSlots.spellLevel],
    });

    if (!data || data.length === 0) {
      // Verify if character exists and is owned by user to distinguish between "not found" and "no slots"
      const character = await db.query.characters.findFirst({
        where: and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        ),
      });

      if (!character) {
        throw new NotFoundError('Character', characterId);
      }
    }

    const slots: SpellSlot[] = data.map((row) => ({
      id: row.id,
      characterId: row.characterId,
      spellLevel: row.spellLevel,
      totalSlots: row.totalSlots,
      usedSlots: row.usedSlots,
      remainingSlots: row.totalSlots - row.usedSlots,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
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

    // Use the slot
    const [updatedSlot] = await db
      .update(characterSpellSlots)
      .set({
        usedSlots: slotData.usedSlots + 1,
        updatedAt: new Date(),
      })
      .where(eq(characterSpellSlots.id, slotData.id))
      .returning();

    if (!updatedSlot) {
      throw new InternalServerError('Failed to use spell slot');
    }

    // Log the usage
    const [logEntry] = await db
      .insert(spellSlotUsageLog)
      .values({
        characterId: characterId,
        sessionId: sessionId || null,
        spellName: spellName,
        spellLevel: spellLevel,
        slotLevelUsed: slotLevelUsed,
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
    // Cantrips cannot be upcast
    if (baseLevel === 0) {
      return {
        canUpcast: false,
        spellLevel: baseLevel,
        targetLevel,
        reason: 'Cantrips cannot be upcast',
      };
    }

    // Target level must be higher than base level
    if (targetLevel <= baseLevel) {
      return {
        canUpcast: false,
        spellLevel: baseLevel,
        targetLevel,
        reason: 'Target level must be higher than spell level',
      };
    }

    // Target level must be valid (1-9)
    if (targetLevel < 1 || targetLevel > 9) {
      return {
        canUpcast: false,
        spellLevel: baseLevel,
        targetLevel,
        reason: 'Target level must be between 1 and 9',
      };
    }

    return {
      canUpcast: true,
      spellLevel: baseLevel,
      targetLevel,
    };
  }

  /**
   * Restore spell slots (long rest or specific restoration) with ownership verification
   * @param input - Restore spell slots input
   * @param userId - User ID for ownership check
   * @returns Result of restoration
   */
  static async restoreSpellSlots(input: RestoreSpellSlotsInput, userId: string): Promise<RestoreSpellSlotsResult> {
    const { characterId, level, amount } = input;

    // Verify ownership and existence
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ),
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    const whereClauses = [eq(characterSpellSlots.characterId, characterId)];

    // Filter by specific level if provided
    if (level !== undefined) {
      if (level < 1 || level > 9) {
        throw new ValidationError('Spell level must be between 1 and 9', { level });
      }
      whereClauses.push(eq(characterSpellSlots.spellLevel, level));
    }

    const slots = await db.query.characterSpellSlots.findMany({
      where: and(...whereClauses),
    });

    if (!slots || slots.length === 0) {
      return {
        characterId,
        slotsRestored: [],
        totalRestored: 0,
      };
    }

    const slotsRestored: Array<{ level: number; restoredAmount: number }> = [];
    let totalRestored = 0;

    // Restore slots
    for (const slot of slots) {
      const currentUsed = slot.usedSlots;

      if (currentUsed === 0) {
        continue; // Nothing to restore
      }

      let restoredAmount: number;

      if (amount !== undefined && amount >= 0) {
        // Restore specific amount
        restoredAmount = Math.min(amount, currentUsed);
      } else {
        // Restore all
        restoredAmount = currentUsed;
      }

      const newUsedSlots = currentUsed - restoredAmount;

      // Update the slot
      await db
        .update(characterSpellSlots)
        .set({
          usedSlots: newUsedSlots,
          updatedAt: new Date(),
        })
        .where(eq(characterSpellSlots.id, slot.id));

      slotsRestored.push({
        level: slot.spellLevel,
        restoredAmount,
      });

      totalRestored += restoredAmount;
    }

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

    const whereClauses = [eq(spellSlotUsageLog.characterId, characterId)];
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
        ? this.calculateSpellSlots(classes[0]?.className ?? 'Fighter', classes[0]?.level ?? 1)
        : this.calculateMulticlassSpellSlots(classes);

    const slots = 'slots' in calculation ? calculation.slots : {};

    // Delete existing slots
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));

    // Insert new slots
    const insertData = Object.entries(slots).map(([level, total]) => ({
      characterId: characterId,
      spellLevel: parseInt(level),
      totalSlots: total,
      usedSlots: 0,
    }));

    if (insertData.length > 0) {
      await db.insert(characterSpellSlots).values(insertData);
    }

    // Return the initialized slots
    return this.getCharacterSpellSlots(characterId, userId);
  }
}
