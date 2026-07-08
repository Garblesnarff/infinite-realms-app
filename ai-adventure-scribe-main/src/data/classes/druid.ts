import type { CharacterClass, AbilityScores } from '@/types/character';
import { classSubclasses } from './subclasses';

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
  spellcasting: {
    ability: 'wisdom' as keyof AbilityScores,
    cantripsKnown: 2,
    ritualCasting: true,
  },
  classFeatures: [
    {
      id: 'druidcraft',
      name: 'Druidcraft',
      description:
        "You know the druidcraft cantrip. It doesn't count against your number of cantrips known.",
    },
    {
      id: 'spellcasting',
      name: 'Spellcasting',
      description:
        'Drawing on the divine essence of nature itself, you can cast spells to shape that essence to your will.',
    },
  ],
};
