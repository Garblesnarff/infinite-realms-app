/**
 * Spell Slot Mechanics Logic
 *
 * Extracted from SpellSlotsService.
 * Handles the pure logic of D&D 5E spell slot calculations,
 * multiclassing rules, and upcasting validation.
 *
 * No database access - all logic is deterministic based on inputs.
 *
 * @module server/services/spell-slots/spell-slot-mechanics
 */

import { ValidationError } from '../../lib/errors.js';

import type {
  SpellSlotCalculation,
  MulticlassSpellSlots,
  UpcastValidation,
  ClassName,
  ClassSpellcasting,
  WarlockPactMagic,
} from '../../types/spell-slots.js';

/**
 * D&D 5E Full Caster Spell Slot Progression (PHB pg. 114)
 * Used by: Wizard, Sorcerer, Cleric, Druid, Bard
 */
export const FULL_CASTER_SLOTS: Record<number, number[]> = {
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
export const WARLOCK_PACT_MAGIC: Record<number, { slots: number; level: number }> = {
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
export const CLASS_SPELLCASTING: Record<ClassName, ClassSpellcasting> = {
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

export class SpellSlotMechanics {
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
}
