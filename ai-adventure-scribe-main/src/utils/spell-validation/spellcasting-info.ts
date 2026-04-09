import type { CharacterClass } from '@/types/character';
import type { SpellcastingInfo } from '@/utils/spell-validation/types';

/**
 * Get complete spellcasting information for a class at level 1
 * Level 1 spell counts by class following D&D 5E rules
 */
export function getSpellcastingInfo(
  characterClass: CharacterClass,
  _level: number = 1,
): SpellcastingInfo | null {
  if (!characterClass.spellcasting) {
    return null;
  }

  const spellcasting = characterClass.spellcasting;

  const levelOneSpellcasting: Record<string, Partial<SpellcastingInfo>> = {
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
      cantripsKnown: 0, // No spellcasting at level 1
      spellsKnown: 0,
      spellcastingAbility: 'charisma',
    },
    Ranger: {
      cantripsKnown: 0, // No spellcasting at level 1
      spellsKnown: 0,
      spellcastingAbility: 'wisdom',
    },
  };

  // Use case-insensitive lookup
  const normalizedClassName =
    characterClass.name.charAt(0).toUpperCase() + characterClass.name.slice(1).toLowerCase();
  const classInfo = levelOneSpellcasting[normalizedClassName];
  if (!classInfo) {
    return null;
  }

  return {
    cantripsKnown: classInfo.cantripsKnown || 0,
    spellsKnown: classInfo.spellsKnown,
    spellsPrepared: classInfo.spellsPrepared,
    hasSpellbook: classInfo.hasSpellbook || false,
    isPactMagic: classInfo.isPactMagic || false,
    ritualCasting: classInfo.ritualCasting || false,
    spellcastingAbility: classInfo.spellcastingAbility || spellcasting.ability,
  };
}
