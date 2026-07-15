import type { AbilityScores } from '@/types/character';

import progressionData from '@/data/srd/progressions.json';

/**
 * D&D 5E Experience Point requirements for each level
 */
export const experienceTable: Record<number, number> = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
  6: 14000,
  7: 23000,
  8: 34000,
  9: 48000,
  10: 64000,
  11: 85000,
  12: 100000,
  13: 120000,
  14: 140000,
  15: 165000,
  16: 195000,
  17: 225000,
  18: 265000,
  19: 305000,
  20: 355000,
};

/**
 * Proficiency bonus by character level
 */
export const proficiencyBonusTable: Record<number, number> = {
  1: 2,
  2: 2,
  3: 2,
  4: 2,
  5: 3,
  6: 3,
  7: 3,
  8: 3,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  13: 5,
  14: 5,
  15: 5,
  16: 5,
  17: 6,
  18: 6,
  19: 6,
  20: 6,
};

/**
 * Multiclassing ability score requirements
 */
export interface MulticlassRequirement {
  allOf?: Array<{ ability: keyof AbilityScores; minimum: number }>;
  anyOf?: Array<{ ability: keyof AbilityScores; minimum: number }>;
}

export const multiclassRequirements: Record<string, MulticlassRequirement> = {
  barbarian: { allOf: [{ ability: 'strength', minimum: 13 }] },
  bard: { allOf: [{ ability: 'charisma', minimum: 13 }] },
  cleric: { allOf: [{ ability: 'wisdom', minimum: 13 }] },
  druid: { allOf: [{ ability: 'wisdom', minimum: 13 }] },
  fighter: {
    anyOf: [
      { ability: 'strength', minimum: 13 },
      { ability: 'dexterity', minimum: 13 },
    ],
  },
  monk: {
    allOf: [
      { ability: 'dexterity', minimum: 13 },
      { ability: 'wisdom', minimum: 13 },
    ],
  },
  paladin: {
    allOf: [
      { ability: 'strength', minimum: 13 },
      { ability: 'charisma', minimum: 13 },
    ],
  },
  ranger: {
    allOf: [
      { ability: 'dexterity', minimum: 13 },
      { ability: 'wisdom', minimum: 13 },
    ],
  },
  rogue: { allOf: [{ ability: 'dexterity', minimum: 13 }] },
  sorcerer: { allOf: [{ ability: 'charisma', minimum: 13 }] },
  warlock: { allOf: [{ ability: 'charisma', minimum: 13 }] },
  wizard: { allOf: [{ ability: 'intelligence', minimum: 13 }] },
};

/**
 * Class features that are gained at specific levels
 */
export interface LevelFeature {
  level: number;
  featureName: string;
  description: string;
  choices?: {
    name: string;
    options: string[];
    description?: string;
  };
  abilityScoreImprovement?: boolean;
}

/** All twelve 2014 SRD class progressions through level 20. */
export const classProgressions = progressionData as Record<string, LevelFeature[]>;

/**
 * Multiclassing proficiencies gained
 */
export const multiclassProficiencies: Record<
  string,
  {
    armor?: string[];
    weapons?: string[];
    tools?: string[];
    skillChoices?: string[];
    numSkillChoices?: number;
  }
> = {
  barbarian: {
    armor: ['Shields'],
    weapons: ['Simple weapons', 'Martial weapons'],
  },
  bard: {
    armor: ['Light armor'],
    weapons: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
    tools: ['One musical instrument of your choice'],
    skillChoices: ['Any'],
    numSkillChoices: 1,
  },
  cleric: {
    armor: ['Light armor', 'Medium armor', 'Shields'],
    weapons: ['Simple weapons'],
  },
  druid: {
    armor: ['Light armor', 'Medium armor', 'Shields (non-metal)'],
    weapons: [
      'Clubs',
      'Daggers',
      'Darts',
      'Javelins',
      'Maces',
      'Quarterstaffs',
      'Scimitars',
      'Sickles',
      'Slings',
      'Spears',
    ],
  },
  fighter: {
    armor: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'],
    weapons: ['Simple weapons', 'Martial weapons'],
  },
  monk: {
    weapons: ['Simple weapons', 'Shortswords'],
  },
  paladin: {
    armor: ['Light armor', 'Medium armor', 'Heavy armor', 'Shields'],
    weapons: ['Simple weapons', 'Martial weapons'],
  },
  ranger: {
    armor: ['Light armor', 'Medium armor', 'Shields'],
    weapons: ['Simple weapons', 'Martial weapons'],
    skillChoices: [
      'Animal Handling',
      'Athletics',
      'Insight',
      'Investigation',
      'Nature',
      'Perception',
      'Stealth',
      'Survival',
    ],
    numSkillChoices: 1,
  },
  rogue: {
    armor: ['Light armor'],
    weapons: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
    tools: ["Thieves' tools"],
    skillChoices: [
      'Acrobatics',
      'Athletics',
      'Deception',
      'Insight',
      'Intimidation',
      'Investigation',
      'Perception',
      'Performance',
      'Persuasion',
      'Sleight of Hand',
      'Stealth',
    ],
    numSkillChoices: 1,
  },
  sorcerer: {
    weapons: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
  },
  warlock: {
    armor: ['Light armor'],
    weapons: ['Simple weapons'],
  },
  wizard: {
    weapons: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
  },
};
