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
  Wizard: {
    className: 'Wizard',
    casterType: 'full',
    spellcastingAbility: 'intelligence',
    spellsKnownOrPrepared: 'prepared',
  },
  Sorcerer: {
    className: 'Sorcerer',
    casterType: 'full',
    spellcastingAbility: 'charisma',
    spellsKnownOrPrepared: 'known',
  },
  Cleric: {
    className: 'Cleric',
    casterType: 'full',
    spellcastingAbility: 'wisdom',
    spellsKnownOrPrepared: 'prepared',
  },
  Druid: {
    className: 'Druid',
    casterType: 'full',
    spellcastingAbility: 'wisdom',
    spellsKnownOrPrepared: 'prepared',
  },
  Bard: {
    className: 'Bard',
    casterType: 'full',
    spellcastingAbility: 'charisma',
    spellsKnownOrPrepared: 'known',
  },

  // Half casters (start at level 2)
  Paladin: {
    className: 'Paladin',
    casterType: 'half',
    spellcastingAbility: 'charisma',
    spellsKnownOrPrepared: 'prepared',
  },
  Ranger: {
    className: 'Ranger',
    casterType: 'half',
    spellcastingAbility: 'wisdom',
    spellsKnownOrPrepared: 'known',
  },

  // Third casters (subclass features)
  'Eldritch Knight': {
    className: 'Eldritch Knight',
    casterType: 'third',
    spellcastingAbility: 'intelligence',
    spellsKnownOrPrepared: 'known',
  },
  'Arcane Trickster': {
    className: 'Arcane Trickster',
    casterType: 'third',
    spellcastingAbility: 'intelligence',
    spellsKnownOrPrepared: 'known',
  },

  // Pact magic
  Warlock: {
    className: 'Warlock',
    casterType: 'pact',
    spellcastingAbility: 'charisma',
    spellsKnownOrPrepared: 'known',
  },

  // Non-casters
  Fighter: {
    className: 'Fighter',
    casterType: 'none',
    spellcastingAbility: null,
    spellsKnownOrPrepared: null,
  },
  Rogue: {
    className: 'Rogue',
    casterType: 'none',
    spellcastingAbility: null,
    spellsKnownOrPrepared: null,
  },
  Barbarian: {
    className: 'Barbarian',
    casterType: 'none',
    spellcastingAbility: null,
    spellsKnownOrPrepared: null,
  },
  Monk: {
    className: 'Monk',
    casterType: 'none',
    spellcastingAbility: null,
    spellsKnownOrPrepared: null,
  },
};

/**
 * Case-insensitive class-name lookup against the class table, mirroring
 * `SpellSlotsService.normalizeClassName`. Kept here so the pure row builder
 * above stays in the single-slot-source module.
 */
function normalizeClassName(raw: string | null | undefined): ClassName | null {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (!normalized) return null;
  const match = (Object.keys(CLASS_SPELLCASTING) as ClassName[]).find(
    (name) => name.toLowerCase() === normalized,
  );
  return match ?? null;
}

/**
 * Third-caster subclasses by lowercase name, with the parent class each one
 * belongs to and the class-table entry it maps to.
 */
const THIRD_CASTER_SUBCLASSES: Record<string, { parent: ClassName; className: ClassName }> = {
  'eldritch knight': { parent: 'Fighter', className: 'Eldritch Knight' },
  'arcane trickster': { parent: 'Rogue', className: 'Arcane Trickster' },
};

/**
 * #420: resolve the effective class for slot calculation. The app sends
 * Fighter/Rogue with a subclass field; a Fighter with the Eldritch Knight
 * subclass (or a Rogue with Arcane Trickster) is a third caster. The subclass
 * only grants slots on its parent class — a mismatched pairing, an unknown
 * subclass, or a subclass on any other class is ignored.
 */
function resolveThirdCasterClass(name: ClassName, subclass: string | null | undefined): ClassName {
  const entry = THIRD_CASTER_SUBCLASSES[(subclass ?? '').trim().toLowerCase()];
  if (!entry || entry.parent !== name) return name;
  return entry.className;
}

/**
 * Normalize raw classLevels JSONB into validated entries. Shared by
 * seedRowsForCharacter and isPactSlotCharacter so both agree on what counts
 * as multiclass.
 */
function parseClassLevels(classLevels: unknown): Array<{ className: ClassName; level: number }> {
  if (!Array.isArray(classLevels)) return [];
  return classLevels
    .map((entry) => {
      const raw = entry as { className?: unknown; level?: unknown };
      const name = typeof raw.className === 'string' ? normalizeClassName(raw.className) : null;
      const entryLevel = typeof raw.level === 'number' && raw.level > 0 ? raw.level : 0;
      return name && entryLevel > 0 ? { className: name, level: entryLevel } : null;
    })
    .filter((entry): entry is { className: ClassName; level: number } => entry !== null);
}

export class SpellSlotMechanics {
  /**
   * #270: rows to seed `character_spell_slots` for a character, from the single
   * slot source (the 2014 5e tables above). Used at creation and at level-up.
   *
   * Non-casters and unrecognized class names yield no rows; multiclass
   * characters use the PHB combined progression, the same rule
   * `ensureSpellSlotRow` applies on a first cast.
   *
   * #397: single-class warlocks seed pact-magic rows — one row at the pact
   * slot level holding the pact slot count (2014 PHB pg. 107). The
   * `character_spell_slots` table has no kind column, so the design records
   * the pact pool as ordinary rows at the pact slot level; that is
   * unambiguous because only single-class warlocks seed pact rows.
   * Multiclass warlocks seed no pact rows: a pact level can collide with a
   * regular row at the same spell level under the table's
   * (character_id, spell_level) unique constraint
   * (`calculateMulticlassSpellSlots` still reports their pact pool separately
   * in `warlockSlots` for other consumers).
   *
   * #420: `subclass` carries the character's subclass (e.g. 'Eldritch
   * Knight'). A Fighter with the Eldritch Knight subclass, or a Rogue with
   * Arcane Trickster, seeds third-caster rows; any other subclass (or none)
   * leaves the class as-is. The subclass applies to the single-class path
   * only — multiclass classLevels entries carry no subclass.
   */
  static seedRowsForCharacter(
    className: string | null | undefined,
    level: number,
    classLevels: unknown,
    subclass?: string | null,
  ): Array<{ spellLevel: number; totalSlots: number }> {
    if (!Number.isInteger(level) || level < 1 || level > 20) {
      return [];
    }

    const parsedLevels = parseClassLevels(classLevels);

    const slots: Record<number, number> =
      parsedLevels.length > 1
        ? SpellSlotMechanics.calculateMulticlassSpellSlots(parsedLevels).slots
        : (() => {
            const name = normalizeClassName(className);
            if (!name) return {};
            if (name === 'Warlock') {
              const pact = WARLOCK_PACT_MAGIC[level];
              return pact ? { [pact.level]: pact.slots } : {};
            }
            // #420: Fighter/Rogue carry their third-caster status in the
            // subclass, not the class name.
            const effectiveName = resolveThirdCasterClass(name, subclass);
            return SpellSlotMechanics.calculateSpellSlots(effectiveName, level).slots;
          })();

    return Object.entries(slots)
      .map(([slotLevel, total]) => ({ spellLevel: Number(slotLevel), totalSlots: total }))
      .filter(
        ({ spellLevel, totalSlots }) =>
          Number.isInteger(spellLevel) &&
          spellLevel >= 1 &&
          spellLevel <= 9 &&
          Number.isInteger(totalSlots) &&
          totalSlots > 0,
      )
      .sort((a, b) => a.spellLevel - b.spellLevel);
  }

  /**
   * #397: whether the character's seeded slot rows are pact-magic rows. True
   * only for single-class warlocks — the only characters seedRowsForCharacter
   * grants pact rows to. Short rests restore pact rows (2014 PHB pg. 107:
   * pact slots recover on a short or long rest); long rests restore every row.
   */
  static isPactSlotCharacter(className: string | null | undefined, classLevels: unknown): boolean {
    if (parseClassLevels(classLevels).length > 1) return false;
    return normalizeClassName(className) === 'Warlock';
  }

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
      // PHB single-class half casters (Paladin, Ranger): spellcasting begins at
      // class level 2, and slots follow the multiclass table at ceil(level/2)
      // (L3 -> 3 first-level slots; L5 -> 4 first + 2 second). The multiclass
      // rule's floor(level/2) applies only when combining classes — see
      // calculateMulticlassSpellSlots.
      casterLevel = level < 2 ? 0 : Math.ceil(level / 2);
    } else if (casterType === 'third') {
      // PHB single-class third casters (Eldritch Knight, Arcane Trickster):
      // spellcasting begins at class level 3, slots follow the multiclass
      // table at ceil(level/3) (L7 -> 4 first + 2 second), max 4th-level slots.
      casterLevel = level < 3 ? 0 : Math.ceil(level / 3);
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
    classes: Array<{ className: ClassName; level: number }>,
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
