import type { CharacterClass, AbilityScores } from '@/types/character';
import { classSubclasses } from './subclasses';

export const monk: CharacterClass = {
  subclasses: classSubclasses.monk,
  id: 'monk',
  name: 'Monk',
  description:
    'A master of martial arts, harnessing inner power and achieving physical perfection.',
  backgroundImage: '/images/classes/monk-class-card-background.png',
  hitDie: 8,
  primaryAbility: 'dexterity' as keyof AbilityScores,
  savingThrowProficiencies: ['strength', 'dexterity'] as (keyof AbilityScores)[],
  skillChoices: ['Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth'],
  numSkillChoices: 2,
  armorProficiencies: [],
  weaponProficiencies: ['Simple weapons', 'Shortswords'],
  toolProficiencies: ["One type of artisan's tools or one musical instrument"],
  classFeatures: [
    {
      id: 'unarmored-defense-monk',
      name: 'Unarmored Defense',
      description:
        'While you are wearing no armor and not wielding a shield, your AC equals 10 + your Dexterity modifier + your Wisdom modifier.',
    },
    {
      id: 'martial-arts',
      name: 'Martial Arts',
      description:
        'You gain the following benefits while unarmed or wielding only monk weapons and not wearing armor or wielding a shield: You can use Dexterity instead of Strength for attack and damage rolls, you can roll a d4 for damage instead of normal damage, and when you use Attack action with unarmed strike or monk weapon, you can make one unarmed strike as a bonus action.',
    },
  ],
};
