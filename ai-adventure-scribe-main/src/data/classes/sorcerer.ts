import type { CharacterClass, AbilityScores } from '@/types/character';

export const sorcerer: CharacterClass = {
  id: 'sorcerer',
  name: 'Sorcerer',
  description:
    'A spellcaster who draws on inherent magic from a draconic or other exotic bloodline.',
  backgroundImage: '/images/classes/sorcerer-class-card-background.png',
  hitDie: 6,
  primaryAbility: 'charisma' as keyof AbilityScores,
  savingThrowProficiencies: ['constitution', 'charisma'] as (keyof AbilityScores)[],
  skillChoices: ['Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion'],
  numSkillChoices: 2,
  armorProficiencies: [],
  weaponProficiencies: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
  spellcasting: {
    ability: 'charisma' as keyof AbilityScores,
    cantripsKnown: 4,
    spellsKnown: 2,
  },
  classFeatures: [
    {
      id: 'sorcerous-origin',
      name: 'Sorcerous Origin',
      description:
        'Choose a sorcerous origin, which describes the source of your innate magical power.',
      choices: {
        name: 'Sorcerous Origin',
        options: [
          'Draconic Bloodline: Your innate magic comes from draconic magic that was mingled with your blood',
          'Wild Magic: Your innate magic comes from the wild forces of chaos',
          'Divine Soul: Your magic derives from a divine source within you',
          'Storm Sorcery: Your innate magic comes from the power of elemental air',
          'Umbral Magic: Your innate magic comes from the Shadow Realm',
        ],
        description:
          'Your choice grants you features at 1st level and again at 6th, 14th, and 18th level.',
      },
    },
    {
      id: 'spellcasting',
      name: 'Spellcasting',
      description:
        'An event in your past, or in the life of a parent or ancestor, left an indelible mark on you, infusing you with arcane magic.',
    },
  ],
};
