import { classSubclasses } from './subclasses';

import type { CharacterClass, AbilityScores } from '@/types/character';

export const bard: CharacterClass = {
  subclasses: classSubclasses.bard,
  id: 'bard',
  name: 'Bard',
  description: 'An inspiring magician whose power echoes the music of creation.',
  backgroundImage: '/images/classes/bard-class-card-background.png',
  hitDie: 8,
  primaryAbility: 'charisma' as keyof AbilityScores,
  savingThrowProficiencies: ['dexterity', 'charisma'] as (keyof AbilityScores)[],
  skillChoices: ['Any'],
  numSkillChoices: 3,
  armorProficiencies: ['Light armor'],
  weaponProficiencies: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
  toolProficiencies: ['Three musical instruments of your choice'],
  spellcasting: {
    ability: 'charisma' as keyof AbilityScores,
    cantripsKnown: 2,
    spellsKnown: 4,
    ritualCasting: true,
  },
  classFeatures: [
    {
      id: 'bardic-inspiration',
      name: 'Bardic Inspiration',
      description:
        'You can inspire others through stirring words or music. To do so, you use a bonus action on your turn to choose one creature other than yourself within 60 feet of you who can hear you. That creature gains one Bardic Inspiration die, a d6.',
    },
    {
      id: 'spellcasting',
      name: 'Spellcasting',
      description:
        'You have learned to untangle and reshape the fabric of reality in harmony with your wishes and music.',
    },
  ],
};
