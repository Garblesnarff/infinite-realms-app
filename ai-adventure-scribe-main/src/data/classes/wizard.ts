import type { CharacterClass, AbilityScores } from '@/types/character';

export const wizard: CharacterClass = {
  id: 'wizard',
  name: 'Wizard',
  description: 'A scholarly magic-user capable of manipulating the structures of reality.',
  backgroundImage: '/images/classes/wizard-class-card-background.png',
  hitDie: 6,
  primaryAbility: 'intelligence' as keyof AbilityScores,
  savingThrowProficiencies: ['intelligence', 'wisdom'] as (keyof AbilityScores)[],
  skillChoices: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'],
  numSkillChoices: 2,
  armorProficiencies: [],
  weaponProficiencies: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
  spellcasting: {
    ability: 'intelligence' as keyof AbilityScores,
    cantripsKnown: 3,
    spellsKnown: 6,
    ritualCasting: true,
    spellbook: true,
  },
  classFeatures: [
    {
      id: 'arcane-recovery',
      name: 'Arcane Recovery',
      description:
        'You have learned to regain some of your magical energy by studying your spellbook. Once per day when you finish a short rest, you can choose expended spell slots to recover. The spell slots can have a combined level that is equal to or less than half your wizard level (rounded up), and none of the slots can be 6th level or higher.',
    },
    {
      id: 'spellcasting',
      name: 'Spellcasting',
      description:
        'As a student of arcane magic, you have a spellbook containing spells that show the first glimmerings of your true power.',
    },
  ],
};
