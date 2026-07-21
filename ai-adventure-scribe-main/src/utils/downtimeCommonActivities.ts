import type { DowntimeActivity } from '@/types/downtimeActivities';

/**
 * Common downtime activities data
 */
export const commonDowntimeActivities: DowntimeActivity[] = [
  {
    id: 'scribing_spell',
    name: 'Scribe a Spell Scroll',
    type: 'scribing_spells',
    description: 'Copy a spell you know into a spell scroll.',
    daysRequired: 1,
    goldCost: 25, // Base cost, varies by spell level
    materialCost: 50, // Base cost, varies by spell level
    skillRequirements: ['Arcana'],
    levelRequirement: 1,
    classRequirement: 'Wizard',
    successDC: 10,
    outcomes: [
      {
        type: 'success',
        description: 'You successfully create a spell scroll.',
        itemsGained: [
          // This would be populated with the actual scroll item
        ],
      },
      {
        type: 'failure',
        description: 'The spell scroll is ruined and materials are wasted.',
        goldRecovery: 0,
      },
    ],
    repeatable: true,
    requiresSupplies: true,
  },
  {
    id: 'craft_item',
    name: 'Craft a Magic Item',
    type: 'crafting',
    description: 'Create a magic item using the crafting rules.',
    daysRequired: 10, // Varies by item
    goldCost: 100, // Base cost, varies by item
    materialCost: 500, // Base cost, varies by item
    toolRequirements: ["Smith's tools", "Alchemist's supplies"],
    skillRequirements: ['Arcana'],
    levelRequirement: 3,
    successDC: 15,
    outcomes: [
      {
        type: 'success',
        description: 'You successfully craft the magic item.',
        itemsGained: [
          // This would be populated with the actual item
        ],
        experienceGained: 250,
      },
      {
        type: 'failure',
        description: 'The crafting fails and half the materials are wasted.',
        goldRecovery: 0,
      },
    ],
    repeatable: true,
    requiresSupplies: true,
  },
  {
    id: 'train_skill',
    name: 'Train a Skill or Tool',
    type: 'training',
    description: 'Spend time training in a skill or tool proficiency.',
    daysRequired: 10,
    goldCost: 50,
    skillRequirements: [],
    successDC: 15,
    outcomes: [
      {
        type: 'success',
        description: 'You gain proficiency in the chosen skill or tool.',
        experienceGained: 100,
      },
      {
        type: 'failure',
        description: 'Your training is not successful, but you learn from the experience.',
        experienceGained: 25,
      },
    ],
    repeatable: false,
    requiresSupplies: true,
  },
  {
    id: 'research_lore',
    name: 'Research Lore',
    type: 'research',
    description: 'Spend time researching a specific topic or piece of lore.',
    daysRequired: 5,
    goldCost: 100,
    skillRequirements: ['Investigation', 'History'],
    successDC: 12,
    outcomes: [
      {
        type: 'success',
        description: 'You discover valuable information about your research topic.',
        experienceGained: 150,
      },
      {
        type: 'failure',
        description: 'Your research yields no new information.',
        experienceGained: 50,
      },
    ],
    repeatable: true,
    requiresSupplies: true,
  },
  {
    id: 'work_job',
    name: 'Work a Job',
    type: 'working',
    description: 'Perform a job or task to earn money.',
    daysRequired: 7,
    skillRequirements: [],
    successDC: 10,
    outcomes: [
      {
        type: 'success',
        description: 'You earn money from your work.',
        goldRecovery: 200,
      },
      {
        type: 'failure',
        description: 'You earn less than expected.',
        goldRecovery: 50,
      },
    ],
    repeatable: true,
    requiresSupplies: false,
  },
  {
    id: 'carouse',
    name: 'Carouse',
    type: 'carousing',
    description: 'Spend time socializing and networking.',
    daysRequired: 7,
    goldCost: 100,
    skillRequirements: ['Persuasion'],
    successDC: 12,
    outcomes: [
      {
        type: 'success',
        description: 'You make valuable social connections.',
        experienceGained: 75,
      },
      {
        type: 'failure',
        description: 'You spend money without making connections.',
        goldRecovery: 0,
      },
    ],
    repeatable: true,
    requiresSupplies: false,
  },
];
