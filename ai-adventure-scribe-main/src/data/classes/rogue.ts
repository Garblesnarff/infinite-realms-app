import { classSubclasses } from './subclasses';

import type { CharacterClass, AbilityScores } from '@/types/character';

export const rogue: CharacterClass = {
  subclasses: classSubclasses.rogue,
  id: 'rogue',
  name: 'Rogue',
  description: 'A scoundrel who uses stealth and trickery to overcome obstacles and enemies.',
  backgroundImage: '/images/classes/rogue-class-card-background.png',
  hitDie: 8,
  primaryAbility: 'dexterity' as keyof AbilityScores,
  savingThrowProficiencies: ['dexterity', 'intelligence'] as (keyof AbilityScores)[],
  skillChoices: [
    'Acrobatics',
    'Athletics',
    'Deception',
    'Insight',
    'Intimidation',
    'Investigation',
    'Perception',
    'Performance',
    'Persuasion',
    'Sleight of Hand',
    'Stealth',
  ],
  numSkillChoices: 4,
  armorProficiencies: ['Light armor'],
  weaponProficiencies: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
  toolProficiencies: ["Thieves' tools"],
  classFeatures: [
    {
      id: 'expertise',
      name: 'Expertise',
      description:
        "At 1st level, choose two of your skill proficiencies, or one of your skill proficiencies and your proficiency with thieves' tools. Your proficiency bonus is doubled for any ability check you make that uses either of the chosen proficiencies.",
    },
    {
      id: 'sneak-attack',
      name: 'Sneak Attack',
      description:
        "Beginning at 1st level, you know how to strike subtly and exploit a foe's distraction. Once per turn, you can deal an extra 1d6 damage to one creature you hit with an attack if you have advantage on the attack roll. The attack must use a finesse or a ranged weapon.",
    },
    {
      id: 'thieves-cant',
      name: "Thieves' Cant",
      description:
        "During your rogue training you learned thieves' cant, a secret mix of dialect, jargon, and code that allows you to hide messages in seemingly normal conversation.",
    },
  ],
};
