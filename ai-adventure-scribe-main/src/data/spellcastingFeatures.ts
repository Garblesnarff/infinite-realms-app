import {
  FULL_CASTER_SLOTS,
  WARLOCK_PACT_MAGIC,
  halfCasterSlots,
} from '../../shared/spell-slot-tables';

import type { AbilityScores } from '@/types/character';

/**
 * Interface for metamagic options (Sorcerer feature)
 */
export interface MetamagicOption {
  id: string;
  name: string;
  description: string;
  sorceryPointCost: number;
  applicableSpellLevels?: number[]; // If undefined, applies to all spell levels
}

/**
 * Interface for spell preparation mechanics
 */
export interface SpellPreparation {
  canPrepareSpells: boolean;
  preparationMethod: 'long-rest' | 'short-rest' | 'never';
  spellsKnownFormula?: string; // e.g., "level + ability_modifier"
  maxPreparedSpells?: number;
  ritualCasting: boolean;
  ritualSpellbook?: boolean; // Can cast ritual spells from spellbook without preparing them
}

/**
 * Interface for pact magic system (Warlock)
 */
export interface PactMagicSystem {
  usePactMagic: boolean;
  pactSlotLevel: number;
  pactSlots: number;
  shortRestRecovery: boolean;
  spellsKnown: number;
  cantripsKnown: number;
}

/**
 * Enhanced spellcasting interface
 */
export interface AdvancedSpellcasting {
  ability: keyof AbilityScores;
  cantripsKnown: number;
  spellsKnown?: number;

  // Spell Preparation
  preparation: SpellPreparation;

  // Pact Magic (Warlock)
  pactMagic?: PactMagicSystem;

  // Metamagic (Sorcerer)
  metamagic?: {
    available: boolean;
    sorceryPoints: number;
    optionsKnown: number;
  };

  // Ritual Casting
  ritualCasting: boolean;

  // Spellbook (Wizard)
  spellbook?: {
    hasSpellbook: boolean;
    ritualCasting: boolean;
    learnSpellsOnLevelUp: number;
    canCopySpells: boolean;
  };
}

/**
 * Metamagic Options for Sorcerers
 */
export const metamagicOptions: MetamagicOption[] = [
  {
    id: 'careful-spell',
    name: 'Careful Spell',
    description:
      "When you cast a spell that forces other creatures to make a saving throw, you can protect some of those creatures from the spell's full force. To do so, you spend 1 sorcery point and choose a number of those creatures up to your Charisma modifier (minimum of one creature). A chosen creature automatically succeeds on its saving throw against the spell.",
    sorceryPointCost: 1,
  },
  {
    id: 'distant-spell',
    name: 'Distant Spell',
    description:
      'When you cast a spell that has a range of 5 feet or greater, you can spend 1 sorcery point to double the range of the spell. When you cast a spell that has a range of touch, you can spend 1 sorcery point to make the range of the spell 30 feet.',
    sorceryPointCost: 1,
  },
  {
    id: 'empowered-spell',
    name: 'Empowered Spell',
    description:
      'When you roll damage for a spell, you can spend 1 sorcery point to reroll a number of the damage dice up to your Charisma modifier (minimum of one). You must use the new rolls. You can use Empowered Spell even if you have already used a different Metamagic option during the casting of the spell.',
    sorceryPointCost: 1,
  },
  {
    id: 'extended-spell',
    name: 'Extended Spell',
    description:
      'When you cast a spell that has a duration of 1 minute or longer, you can spend 1 sorcery point to double its duration, to a maximum duration of 24 hours.',
    sorceryPointCost: 1,
  },
  {
    id: 'heightened-spell',
    name: 'Heightened Spell',
    description:
      'When you cast a spell that forces a creature to make a saving throw to resist its effects, you can spend 3 sorcery points to give one target of the spell disadvantage on its first saving throw made against the spell.',
    sorceryPointCost: 3,
  },
  {
    id: 'quickened-spell',
    name: 'Quickened Spell',
    description:
      'When you cast a spell that has a casting time of 1 action, you can spend 2 sorcery points to change the casting time to 1 bonus action for this casting.',
    sorceryPointCost: 2,
    applicableSpellLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  },
  {
    id: 'subtle-spell',
    name: 'Subtle Spell',
    description:
      'When you cast a spell, you can spend 1 sorcery point to cast it without any somatic or verbal components.',
    sorceryPointCost: 1,
  },
  {
    id: 'twinned-spell',
    name: 'Twinned Spell',
    description:
      "When you cast a spell that targets only one creature and doesn't have a range of self, you can spend a number of sorcery points equal to the spell's level to target a second creature in range with the same spell (1 sorcery point if the spell is a cantrip). To be eligible, a spell must be incapable of targeting more than one creature at the spell's current level.",
    sorceryPointCost: 1, // Variable based on spell level
  },
];

/**
 * Spellcasting progression tables for different classes.
 *
 * #617: slot arrays derive from shared/spell-slot-tables.ts (epic #616).
 * Cantrips/spells-known stay here — they are not slot tables.
 */
const fullCasterEntry = (level: number, cantrips: number) => ({
  cantrips,
  spells: [...(FULL_CASTER_SLOTS[level] ?? [])],
});

const halfCasterEntry = (level: number) => ({
  cantrips: 0,
  // The legacy half-caster table carried 5 spell levels; slice to match.
  spells: [...halfCasterSlots(level).slice(0, 5)],
});

const pactEntry = (level: number, cantrips: number, spellsKnown: number) => {
  const pact = WARLOCK_PACT_MAGIC[level];
  return {
    cantrips,
    pactSlots: pact?.slots ?? 0,
    pactSlotLevel: pact?.level ?? 0,
    spellsKnown,
  };
};

export const spellcastingProgression = {
  fullCaster: {
    1: fullCasterEntry(1, 3),
    2: fullCasterEntry(2, 3),
    3: fullCasterEntry(3, 3),
    4: fullCasterEntry(4, 4),
    5: fullCasterEntry(5, 4),
    6: fullCasterEntry(6, 4),
    7: fullCasterEntry(7, 4),
    8: fullCasterEntry(8, 4),
    9: fullCasterEntry(9, 4),
    10: fullCasterEntry(10, 5),
    11: fullCasterEntry(11, 5),
    12: fullCasterEntry(12, 5),
    13: fullCasterEntry(13, 5),
    14: fullCasterEntry(14, 5),
    15: fullCasterEntry(15, 5),
    16: fullCasterEntry(16, 5),
    17: fullCasterEntry(17, 5),
    18: fullCasterEntry(18, 5),
    19: fullCasterEntry(19, 5),
    20: fullCasterEntry(20, 5),
  },
  halfCaster: {
    2: halfCasterEntry(2),
    3: halfCasterEntry(3),
    4: halfCasterEntry(4),
    5: halfCasterEntry(5),
    6: halfCasterEntry(6),
    7: halfCasterEntry(7),
    8: halfCasterEntry(8),
    9: halfCasterEntry(9),
    10: halfCasterEntry(10),
    11: halfCasterEntry(11),
    12: halfCasterEntry(12),
    13: halfCasterEntry(13),
    14: halfCasterEntry(14),
    15: halfCasterEntry(15),
    16: halfCasterEntry(16),
    17: halfCasterEntry(17),
    18: halfCasterEntry(18),
    19: halfCasterEntry(19),
    20: halfCasterEntry(20),
  },
  pactMagic: {
    1: pactEntry(1, 2, 2),
    2: pactEntry(2, 2, 3),
    3: pactEntry(3, 2, 4),
    4: pactEntry(4, 3, 5),
    5: pactEntry(5, 3, 6),
    6: pactEntry(6, 3, 7),
    7: pactEntry(7, 3, 8),
    8: pactEntry(8, 3, 9),
    9: pactEntry(9, 3, 10),
    10: pactEntry(10, 4, 10),
    11: pactEntry(11, 4, 11),
    12: pactEntry(12, 4, 11),
    13: pactEntry(13, 4, 12),
    14: pactEntry(14, 4, 12),
    15: pactEntry(15, 4, 13),
    16: pactEntry(16, 4, 13),
    17: pactEntry(17, 4, 14),
    18: pactEntry(18, 4, 14),
    19: pactEntry(19, 4, 15),
    20: pactEntry(20, 4, 15),
  },
};

/**
 * Helper functions
 */
export const getSpellSlotsByLevel = (characterClass: string, level: number): number[] => {
  if (characterClass.toLowerCase() === 'warlock') {
    return []; // Warlocks use Pact Magic, not regular spell slots
  }

  const isHalfCaster = ['paladin', 'ranger'].includes(characterClass.toLowerCase());
  const progression = isHalfCaster
    ? spellcastingProgression.halfCaster
    : spellcastingProgression.fullCaster;

  return progression[level as keyof typeof progression]?.spells || [];
};

export const getPactMagicProgression = (level: number) => {
  return spellcastingProgression.pactMagic[level as keyof typeof spellcastingProgression.pactMagic];
};

export const calculateSpellsKnown = (
  characterClass: string,
  level: number,
  abilityModifier: number,
): number => {
  const className = characterClass.toLowerCase();

  switch (className) {
    case 'bard':
    case 'ranger':
    case 'sorcerer':
    case 'warlock':
      // These classes have a fixed spells known progression
      return 0; // Should be looked up in class-specific tables

    case 'cleric':
    case 'druid':
    case 'paladin':
      // Prepare spells = level + ability modifier
      return Math.max(1, level + abilityModifier);

    case 'wizard':
      // Wizards learn spells in spellbook, prepare level + int modifier
      return Math.max(1, level + abilityModifier);

    default:
      return 0;
  }
};

export const canCastRituals = (characterClass: string): boolean => {
  return ['bard', 'cleric', 'druid', 'wizard'].includes(characterClass.toLowerCase());
};

export const hasPactMagic = (characterClass: string): boolean => {
  return characterClass.toLowerCase() === 'warlock';
};

export const hasMetamagic = (characterClass: string, level: number): boolean => {
  return characterClass.toLowerCase() === 'sorcerer' && level >= 3;
};

export const getSorceryPoints = (level: number): number => {
  return Math.max(0, level);
};

export const getMetamagicOptionsKnown = (level: number): number => {
  if (level < 3) return 0;
  if (level < 10) return 2;
  if (level < 17) return 3;
  return 4;
};
