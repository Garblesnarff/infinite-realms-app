import type { CharacterClass, AbilityScores } from '@/types/character';

export const warlock: CharacterClass = {
  id: 'warlock',
  name: 'Warlock',
  description: 'A wielder of magic derived from a bargain with an extraplanar entity.',
  backgroundImage: '/images/classes/warlock-class-card-background.png',
  hitDie: 8,
  primaryAbility: 'charisma' as keyof AbilityScores,
  savingThrowProficiencies: ['wisdom', 'charisma'] as (keyof AbilityScores)[],
  skillChoices: [
    'Arcana',
    'Deception',
    'History',
    'Intimidation',
    'Investigation',
    'Nature',
    'Religion',
  ],
  numSkillChoices: 2,
  armorProficiencies: ['Light armor'],
  weaponProficiencies: ['Simple weapons'],
  spellcasting: {
    ability: 'charisma' as keyof AbilityScores,
    cantripsKnown: 2,
    spellsKnown: 2,
    pactMagic: true,
  },
  classFeatures: [
    {
      id: 'otherworldly-patron',
      name: 'Otherworldly Patron',
      description: 'You have struck a pact with an otherworldly being.',
      choices: {
        name: 'Otherworldly Patron',
        options: [
          'The Archfey: Your patron is a lord or lady of the fey',
          'The Fiend: Your patron is a fiend from the lower planes',
          'The Great Old One: Your patron is a mysterious entity whose nature is alien to the fabric of reality',
          'The Celestial: Your patron is a powerful being of the Upper Planes',
          'The Bladebound: Your patron is a mysterious entity from the Shadow Realm',
        ],
        description: 'Your choice of patron influences which spells you have access to.',
      },
    },
    {
      id: 'pact-magic',
      name: 'Pact Magic',
      description:
        'Your arcane research and the magic bestowed on you by your patron have given you facility with spells. You regain all expended spell slots when you finish a short or long rest.',
    },
  ],
};
