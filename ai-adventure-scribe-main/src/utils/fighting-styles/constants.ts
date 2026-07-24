import type {
  FightingStyle,
  FightingStyleName,
} from '@/types/combat';

/**
 * All fighting styles and their effects
 */
export const FIGHTING_STYLES: Record<FightingStyleName, FightingStyle> = {
  defense: {
    name: 'defense',
    description: 'While you are wearing armor, you gain a +1 bonus to AC.',
    effect: {
      acBonus: 1,
    },
  },

  dueling: {
    name: 'dueling',
    description:
      'When you are wielding a melee weapon in one hand and no other weapons, you gain a +2 bonus to damage rolls with that weapon.',
    effect: {
      damageBonus: 2,
    },
  },

  great_weapon_fighting: {
    name: 'great_weapon_fighting',
    description:
      'When you roll a 1 or 2 on a damage die for an attack you make with a melee weapon that you are wielding with two hands, you can reroll the die and must use the new roll.',
    effect: {
      rerollDamage: true,
    },
  },

  protection: {
    name: 'protection',
    description:
      'When a creature you can see attacks a target other than you that is within 5 feet of you, you can use your reaction to impose disadvantage on the attack roll.',
    effect: {
      protectionReaction: true,
    },
  },

  archery: {
    name: 'archery',
    description: 'You gain a +2 bonus to attack rolls you make with ranged weapons.',
    effect: {
      attackBonus: 2,
    },
  },

  two_weapon_fighting: {
    name: 'two_weapon_fighting',
    description:
      'When you fight with two weapons, you can add your ability modifier to the damage of the second attack.',
    effect: {
      damageBonus: 0, // Applied specifically to off-hand attacks
    },
  },

  blessed_warrior: {
    name: 'blessed_warrior',
    description: 'You learn two cantrips of your choice from the cleric spell list.',
    effect: {},
  },

  blind_fighting: {
    name: 'blind_fighting',
    description: 'You have blindsight with a range of 10 feet.',
    effect: {},
  },
};
