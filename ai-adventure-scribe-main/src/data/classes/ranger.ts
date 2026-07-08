import type { CharacterClass, AbilityScores } from '@/types/character';
import { classSubclasses } from './subclasses';

export const ranger: CharacterClass = {
  subclasses: classSubclasses.ranger,
  id: 'ranger',
  name: 'Ranger',
  description: 'A warrior of the wilderness, skilled in tracking, survival, and combat.',
  backgroundImage: '/images/classes/ranger-class-card-background.png',
  hitDie: 10,
  primaryAbility: 'dexterity' as keyof AbilityScores,
  savingThrowProficiencies: ['strength', 'dexterity'] as (keyof AbilityScores)[],
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
  numSkillChoices: 3,
  armorProficiencies: ['Light armor', 'Medium armor', 'Shields'],
  weaponProficiencies: ['Simple weapons', 'Martial weapons'],
  classFeatures: [
    {
      id: 'favored-enemy',
      name: 'Favored Enemy',
      description:
        'Choose a type of favored enemy: beasts, fey, humanoids, monstrosities, or undead. You have advantage on Wisdom (Survival) checks to track your favored enemies, as well as on Intelligence checks to recall information about them.',
      choices: {
        name: 'Favored Enemy',
        options: [
          'Beasts: Natural animals and magical beasts',
          'Fey: Creatures from the Feywild',
          'Humanoids: People and human-like creatures',
          'Monstrosities: Frightening creatures of unnatural origin',
          'Undead: Once-living creatures brought to a horrifying state of undeath',
        ],
        description:
          'Choose the type of creature you have studied and learned to hunt effectively.',
      },
    },
    {
      id: 'natural-explorer',
      name: 'Natural Explorer',
      description:
        'Choose a favored terrain: forest, mountains, swamp, coast, desert, grassland, or underdark. When you make a Wisdom (Survival) check in your favored terrain, your proficiency bonus is doubled.',
      choices: {
        name: 'Favored Terrain',
        options: [
          'Forest: Woodlands and jungles',
          'Mountains: High peaks and alpine regions',
          'Swamp: Wetlands and marshes',
          'Coast: Beaches and coastal regions',
          'Desert: Arid wastelands and dunes',
          'Grassland: Plains and prairies',
          'Deep Caverns: Subterranean caverns and tunnels',
        ],
        description:
          'Choose the terrain where you are most at home and have learned to navigate expertly.',
      },
    },
  ],
};
