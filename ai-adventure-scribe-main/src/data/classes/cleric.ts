import { classSubclasses } from './subclasses';

import type { CharacterClass, AbilityScores } from '@/types/character';

export const cleric: CharacterClass = {
  subclasses: classSubclasses.cleric,
  id: 'cleric',
  name: 'Cleric',
  description: 'A priestly champion who wields divine magic in service of a higher power.',
  backgroundImage: '/images/classes/cleric-class-card-background.png',
  hitDie: 8,
  primaryAbility: 'wisdom' as keyof AbilityScores,
  savingThrowProficiencies: ['wisdom', 'charisma'] as (keyof AbilityScores)[],
  skillChoices: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
  numSkillChoices: 2,
  armorProficiencies: ['Light armor', 'Medium armor', 'Shields'],
  weaponProficiencies: ['Simple weapons'],
  spellcasting: {
    ability: 'wisdom' as keyof AbilityScores,
    cantripsKnown: 3,
    ritualCasting: true,
  },
  classFeatures: [
    {
      id: 'divine-domain',
      name: 'Divine Domain',
      description:
        'Choose one domain related to your deity. Your choice grants you domain spells and other features when you choose it at 1st level.',
      choices: {
        name: 'Divine Domain',
        options: [
          'Life Domain: Focuses on healing and protection',
          'Light Domain: Harnesses the power of flame and radiance',
          'War Domain: Guides warriors in battle',
          'Storm Domain: Commands storms and lightning',
          'Nature Domain: Connects with the natural world',
        ],
        description:
          'Each domain provides additional spells and abilities that reflect the nature of your deity.',
      },
    },
    {
      id: 'spellcasting',
      name: 'Spellcasting',
      description: 'As a conduit for divine power, you can cast cleric spells.',
    },
  ],
};
