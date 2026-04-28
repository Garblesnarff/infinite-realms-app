import type { CharacterClass } from '@/types/character';
import type { SpellcastingInfo } from '@/utils/spell-validation/types';

/**
 * Get complete spellcasting information for a class at a given level
 * Level-based spell counts by class following D&D 5E rules
 */
export function getSpellcastingInfo(
  characterClass: CharacterClass,
  level: number = 1,
): SpellcastingInfo | null {
  if (!characterClass.spellcasting && level === 1) {
    return null;
  }

  const spellcasting = characterClass.spellcasting;

  // Level 1 defaults - used for reference or base values
  const baseSpellcasting: Record<string, Partial<SpellcastingInfo>> = {
    Wizard: {
      cantripsKnown: 3,
      spellsKnown: 6, // In spellbook
      hasSpellbook: true,
      ritualCasting: true,
      spellcastingAbility: 'intelligence',
    },
    Cleric: {
      cantripsKnown: 3,
      spellsPrepared: 1, // Wis mod + level (minimum 1)
      ritualCasting: true,
      spellcastingAbility: 'wisdom',
    },
    Bard: {
      cantripsKnown: 2,
      spellsKnown: 4,
      ritualCasting: false,
      spellcastingAbility: 'charisma',
    },
    Druid: {
      cantripsKnown: 2,
      spellsPrepared: 1, // Wis mod + level (minimum 1)
      ritualCasting: true,
      spellcastingAbility: 'wisdom',
    },
    Sorcerer: {
      cantripsKnown: 4,
      spellsKnown: 2,
      ritualCasting: false,
      spellcastingAbility: 'charisma',
    },
    Warlock: {
      cantripsKnown: 2,
      spellsKnown: 2,
      isPactMagic: true,
      ritualCasting: false,
      spellcastingAbility: 'charisma',
    },
    Paladin: {
      cantripsKnown: 0,
      spellsPrepared: 0,
      ritualCasting: false,
      spellcastingAbility: 'charisma',
    },
    Ranger: {
      cantripsKnown: 0,
      spellsKnown: 0,
      ritualCasting: false,
      spellcastingAbility: 'wisdom',
    },
  };

  // Use case-insensitive lookup
  const normalizedClassName =
    characterClass.name.charAt(0).toUpperCase() + characterClass.name.slice(1).toLowerCase();
  const classBase = baseSpellcasting[normalizedClassName];

  if (!classBase && !spellcasting) {
    return null;
  }

  // Handle level-based scaling
  const result: SpellcastingInfo = {
    cantripsKnown: classBase?.cantripsKnown || 0,
    spellsKnown: classBase?.spellsKnown,
    spellsPrepared: classBase?.spellsPrepared,
    hasSpellbook: classBase?.hasSpellbook || false,
    isPactMagic: classBase?.isPactMagic || false,
    ritualCasting: classBase?.ritualCasting || false,
    spellcastingAbility: classBase?.spellcastingAbility || (spellcasting?.ability || 'intelligence'),
  };

  // Wizard cantrip scaling: 3 at lvl 1, 4 at lvl 4, 5 at lvl 10
  if (normalizedClassName === 'Wizard') {
    result.cantripsKnown = level >= 10 ? 5 : level >= 4 ? 4 : 3;
    result.spellsKnown = 6 + (level - 1) * 2;
  }

  // Sorcerer cantrip scaling: 4 at lvl 1, 5 at lvl 4, 6 at lvl 10
  if (normalizedClassName === 'Sorcerer') {
    result.cantripsKnown = level >= 10 ? 6 : level >= 4 ? 5 : 4;
    // Sorcerer spells known table
    const sorcererSpells = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15];
    result.spellsKnown = sorcererSpells[Math.min(level, 20)];
  }

  // Bard cantrip scaling: 2 at lvl 1, 3 at lvl 4, 4 at lvl 10
  if (normalizedClassName === 'Bard') {
    result.cantripsKnown = level >= 10 ? 4 : level >= 4 ? 3 : 2;
    const bardSpells = [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22];
    result.spellsKnown = bardSpells[Math.min(level, 20)];
  }

  // Cleric/Druid cantrip scaling: 3/2 at lvl 1, 4/3 at lvl 4, 5/4 at lvl 10
  if (normalizedClassName === 'Cleric') {
    result.cantripsKnown = level >= 10 ? 5 : level >= 4 ? 4 : 3;
    result.spellsPrepared = level; // Base preparation: level + mod
  }
  if (normalizedClassName === 'Druid') {
    result.cantripsKnown = level >= 10 ? 4 : level >= 4 ? 3 : 2;
    result.spellsPrepared = level;
  }

  // Warlock cantrip scaling: 2 at lvl 1, 3 at lvl 4, 4 at lvl 10
  if (normalizedClassName === 'Warlock') {
    result.cantripsKnown = level >= 10 ? 4 : level >= 4 ? 3 : 2;
    const warlockSpells = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15];
    result.spellsKnown = warlockSpells[Math.min(level, 20)];
  }

  // Half-casters: Paladin and Ranger
  if (normalizedClassName === 'Paladin') {
    result.cantripsKnown = 0;
    result.spellsPrepared = level >= 2 ? Math.floor(level / 2) : 0;
  }
  if (normalizedClassName === 'Ranger') {
    result.cantripsKnown = 0;
    const rangerSpells = [0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 12, 14, 14, 15, 15, 15, 15, 15];
    result.spellsKnown = rangerSpells[Math.min(level, 20)];
  }

  return result;
}
