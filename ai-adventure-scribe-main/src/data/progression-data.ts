import type { AbilityScores } from '@/types/character';

import progressionData from '@/data/srd/progressions.json';

/** D&D 5E experience to reach each level. The numbers live in shared/xp-tables.ts. */
export { XP_TO_REACH_LEVEL as experienceTable } from '../../shared/xp-tables';

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
