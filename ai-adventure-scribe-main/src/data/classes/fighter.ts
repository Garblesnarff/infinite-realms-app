import type { CharacterClass, AbilityScores } from '@/types/character';

export const fighter: CharacterClass = {
  id: 'fighter',
  name: 'Fighter',
  description: 'A master of martial combat, skilled with a variety of weapons and armor.',
  backgroundImage: '/images/classes/fighter-class-card-background.png',
  hitDie: 10,
  primaryAbility: 'strength' as keyof AbilityScores,
  savingThrowProficiencies: ['strength', 'constitution'] as (keyof AbilityScores)[],
  skillChoices: [
    'Acrobatics',
    'Animal Handling',
    'Athletics',
    'History',
    'Insight',
    'Intimidation',
    'Perception',
    'Survival',
  ],
  numSkillChoices: 2,
  armorProficiencies: ['All armor', 'Shields'],
  weaponProficiencies: ['Simple weapons', 'Martial weapons'],
  classFeatures: [
    {
      id: 'fighting-style',
      name: 'Fighting Style',
      description:
        'You adopt a particular style of fighting as your specialty. Choose one of the following options.',
      choices: {
        name: 'Fighting Style',
        options: [
          'Archery: +2 bonus to ranged weapon attacks',
          'Defense: +1 AC while wearing armor',
          'Dueling: +2 damage when wielding a one-handed weapon with no other weapon',
          'Great Weapon Fighting: Reroll 1s and 2s on damage dice for two-handed weapons',
          'Protection: Use reaction to impose disadvantage on attack against nearby ally (requires shield)',
          'Two-Weapon Fighting: Add ability modifier to damage of second attack',
        ],
        description:
          "You can't take the same Fighting Style option more than once, even if you get to choose again.",
      },
    },
    {
      id: 'second-wind',
      name: 'Second Wind',
      description:
        'You have a limited well of stamina that you can draw on to protect yourself from harm. On your turn, you can use a bonus action to regain hit points equal to 1d10 + your fighter level. Once you use this feature, you must finish a short or long rest before you can use it again.',
    },
  ],
};
