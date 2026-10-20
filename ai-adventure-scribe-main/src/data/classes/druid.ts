import { classSubclasses } from './subclasses';

import type { CharacterClass, AbilityScores } from '@/types/character';

export const druid: CharacterClass = {
  subclasses: classSubclasses.druid,
  id: 'druid',
  name: 'Druid',
  description: 'A priest of nature, wielding elemental forces and transforming into animals.',
  backgroundImage: '/images/classes/druid-class-card-background.png',
  hitDie: 8,
  primaryAbility: 'wisdom' as keyof AbilityScores,
  savingThrowProficiencies: ['intelligence', 'wisdom'] as (keyof AbilityScores)[],
  skillChoices: [
    'Arcana',
    'Animal Handling',
    'Insight',
    'Medicine',
    'Nature',
    'Perception',
    'Religion',
    'Survival',
  ],
  numSkillChoices: 2,
  armorProficiencies: ['Light armor', 'Medium armor', 'Shields (non-metal)'],
  weaponProficiencies: [
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
  toolProficiencies: ['Herbalism kit'],
  // Druids know Druidic, the secret language of druids, from 1st level.
  languages: ['Druidic'],
  spellcasting: {
    ability: 'wisdom' as keyof AbilityScores,
    cantripsKnown: 2,
    ritualCasting: true,
  },
  classFeatures: [
    {
      id: 'druidic',
      name: 'Druidic',
      description:
        'You know Druidic, the secret language of druids. You can speak the language and use it to leave hidden messages. You can also use it to communicate basic ideas with other druids without speaking aloud.',
    },
    {
      id: 'spellcasting',
      name: 'Spellcasting',
      description:
        'Drawing on the divine essence of nature itself, you can cast spells to shape that essence to your will.',
    },
  ],
};
