import type { CharacterClass, AbilityScores } from '@/types/character';

export const barbarian: CharacterClass = {
  id: 'barbarian',
  name: 'Barbarian',
  description: 'A fierce warrior of primitive background who can enter a battle rage.',
  backgroundImage: '/images/classes/barbarian-class-card-background.png',
  hitDie: 12,
  primaryAbility: 'strength' as keyof AbilityScores,
  savingThrowProficiencies: ['strength', 'constitution'] as (keyof AbilityScores)[],
  skillChoices: [
    'Animal Handling',
    'Athletics',
    'Intimidation',
    'Nature',
    'Perception',
    'Survival',
  ],
  numSkillChoices: 2,
  armorProficiencies: ['Light armor', 'Medium armor', 'Shields'],
  weaponProficiencies: ['Simple weapons', 'Martial weapons'],
  classFeatures: [
    {
      id: 'rage',
      name: 'Rage',
      description:
        'In battle, you fight with primal ferocity. On your turn, you can enter a rage as a bonus action. While raging, you gain advantage on Strength checks and Strength saving throws, +2 damage to melee attacks using Strength, and resistance to bludgeoning, piercing, and slashing damage. You can rage once per long rest.',
    },
    {
      id: 'unarmored-defense',
      name: 'Unarmored Defense',
      description:
        'While you are not wearing any armor, your Armor Class equals 10 + your Dexterity modifier + your Constitution modifier. You can use a shield and still gain this benefit.',
    },
  ],
};
