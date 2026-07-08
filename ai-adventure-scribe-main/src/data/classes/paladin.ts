import type { CharacterClass, AbilityScores } from '@/types/character';
import { classSubclasses } from './subclasses';

export const paladin: CharacterClass = {
  subclasses: classSubclasses.paladin,
  id: 'paladin',
  name: 'Paladin',
  description:
    'A holy warrior bound to a sacred oath, wielding divine magic and martial prowess.',
  backgroundImage: '/images/classes/paladin-class-card-background.png',
  hitDie: 10,
  primaryAbility: 'strength' as keyof AbilityScores,
  savingThrowProficiencies: ['wisdom', 'charisma'] as (keyof AbilityScores)[],
  skillChoices: ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion'],
  numSkillChoices: 2,
  armorProficiencies: ['All armor', 'Shields'],
  weaponProficiencies: ['Simple weapons', 'Martial weapons'],
  classFeatures: [
    {
      id: 'divine-sense',
      name: 'Divine Sense',
      description:
        'You can use your action to detect good and evil. Until the end of your next turn, you know the location of any celestial, fiend, or undead within 60 feet that is not behind total cover. You can use this feature once per long rest.',
    },
    {
      id: 'lay-on-hands',
      name: 'Lay on Hands',
      description:
        'You have a pool of healing power that replenishes when you take a long rest. With that pool, you can restore a total number of hit points equal to your paladin level × 5. As an action, you can touch a creature and draw power from the pool to restore hit points to that creature.',
    },
  ],
};
