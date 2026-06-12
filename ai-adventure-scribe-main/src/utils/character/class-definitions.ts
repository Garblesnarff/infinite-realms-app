/**
 * Class Definitions and Resource Initialization
 *
 * Extracted from classFeatures.ts.
 * Defines D&D 5e class features and resource scaling.
 */

import type { ClassFeature, CharacterResources } from '@/types/combat';

/**
 * Get class features for a given class and level
 */
export const CLASS_FEATURES_MAP: Record<string, (level: number) => ClassFeature[]> = {
  barbarian: (level: number) => {
    const features: ClassFeature[] = [];

    if (level >= 1) {
      features.push({
        name: 'rage',
        description:
          'In battle, you fight with primal ferocity. You gain resistance to bludgeoning, piercing, and slashing damage, and bonus damage to Strength-based melee attacks.',
        className: 'barbarian',
        level: 1,
        type: 'bonus_action',
        usesPerRest: 'long',
        maxUses: level < 3 ? 2 : level < 6 ? 3 : level < 12 ? 4 : level < 17 ? 5 : 6,
        currentUses: level < 3 ? 2 : level < 6 ? 3 : level < 12 ? 4 : level < 17 ? 5 : 6,
      });

      features.push({
        name: 'unarmored_defense',
        description:
          'While you are not wearing any armor, your Armor Class equals 10 + your Dexterity modifier + your Constitution modifier. You can use a shield and still gain this benefit.',
        className: 'barbarian',
        level: 1,
        type: 'passive',
        usesPerRest: 'none',
      });
    }

    return features;
  },

  rogue: (level: number) => {
    const features: ClassFeature[] = [];

    if (level >= 1) {
      features.push({
        name: 'sneak_attack',
        description:
          'Once per turn, you can deal extra damage when you hit a target with advantage or when another enemy is within 5 feet of the target.',
        className: 'rogue',
        level: 1,
        type: 'passive',
        usesPerRest: 'none',
      });
    }

    if (level >= 5) {
      features.push({
        name: 'uncanny_dodge',
        description:
          'When an attacker that you can see hits you with an attack, you can use your reaction to halve the damage.',
        className: 'rogue',
        level: 5,
        type: 'reaction',
        usesPerRest: 'none',
      });
    }

    return features;
  },

  fighter: (level: number) => {
    const features: ClassFeature[] = [];

    if (level >= 1) {
      features.push({
        name: 'second_wind',
        description:
          'You can use a bonus action to regain hit points equal to 1d10 + your fighter level.',
        className: 'fighter',
        level: 1,
        type: 'bonus_action',
        usesPerRest: 'short',
        maxUses: 1,
        currentUses: 1,
      });
    }

    if (level >= 2) {
      features.push({
        name: 'action_surge',
        description:
          'You can take one additional action on top of your regular action and a possible bonus action.',
        className: 'fighter',
        level: 2,
        type: 'active',
        usesPerRest: 'short',
        maxUses: level >= 17 ? 2 : 1,
        currentUses: level >= 17 ? 2 : 1,
      });
    }

    return features;
  },

  paladin: (level: number) => {
    const features: ClassFeature[] = [];

    if (level >= 1) {
      features.push({
        name: 'lay_on_hands',
        description:
          'Your blessed touch can heal wounds. You have a pool of healing power that replenishes when you take a long rest.',
        className: 'paladin',
        level: 1,
        type: 'active',
        usesPerRest: 'long',
        maxUses: level * 5,
        currentUses: level * 5,
      });
    }

    if (level >= 2) {
      features.push({
        name: 'divine_smite',
        description:
          'When you hit a creature with a melee weapon attack, you can expend one spell slot to deal radiant damage to the target.',
        className: 'paladin',
        level: 2,
        type: 'passive',
        usesPerRest: 'none',
      });
    }

    return features;
  },

  monk: (level: number) => {
    const features: ClassFeature[] = [];

    if (level >= 1) {
      features.push({
        name: 'ki',
        description: 'Your training allows you to harness the mystic energy of ki.',
        className: 'monk',
        level: 2,
        type: 'passive',
        usesPerRest: 'short',
      });

      features.push({
        name: 'unarmored_defense',
        description:
          'While you are wearing no armor and not wielding a shield, your AC equals 10 + your Dexterity modifier + your Wisdom modifier.',
        className: 'monk',
        level: 1,
        type: 'passive',
        usesPerRest: 'none',
      });
    }

    if (level >= 3) {
      features.push({
        name: 'deflect_missiles',
        description:
          'You can use your reaction to deflect or catch the missile when you are hit by a ranged weapon attack.',
        className: 'monk',
        level: 3,
        type: 'reaction',
        usesPerRest: 'none',
      });
    }

    return features;
  },

  bard: (level: number) => {
    const features: ClassFeature[] = [];

    if (level >= 1) {
      features.push({
        name: 'bardic_inspiration',
        description:
          'You can inspire others through stirring words or music, giving them a Bardic Inspiration die.',
        className: 'bard',
        level: 1,
        type: 'bonus_action',
        usesPerRest: 'short',
        maxUses: level < 5 ? 2 : level < 15 ? 3 : 4,
        currentUses: level < 5 ? 2 : level < 15 ? 3 : 4,
      });
    }

    return features;
  },

  cleric: (level: number) => {
    const features: ClassFeature[] = [];

    if (level >= 2) {
      features.push({
        name: 'channel_divinity',
        description: 'You can channel divine energy to fuel magical effects.',
        className: 'cleric',
        level: 2,
        type: 'active',
        usesPerRest: 'short',
        maxUses: level < 6 ? 1 : level < 18 ? 2 : 3,
        currentUses: level < 6 ? 1 : level < 18 ? 2 : 3,
      });
    }

    return features;
  },
};

/**
 * Get hit die for a class
 */
export function getHitDie(className: string): number {
  const hitDice: Record<string, number> = {
    barbarian: 12,
    fighter: 10,
    paladin: 10,
    ranger: 10,
    bard: 8,
    cleric: 8,
    druid: 8,
    monk: 8,
    rogue: 8,
    warlock: 8,
    sorcerer: 6,
    wizard: 6,
  };

  return hitDice[className.toLowerCase()] || 8;
}

/**
 * Initialize character resources based on class and level
 */
export function getInitialCharacterResources(className: string, level: number): CharacterResources {
  const resources: CharacterResources = {
    hitDice: {
      [`d${getHitDie(className)}`]: { max: level, current: level },
    },
  };

  switch (className.toLowerCase()) {
    case 'barbarian':
      resources.rages = {
        max: level < 3 ? 2 : level < 6 ? 3 : level < 12 ? 4 : level < 17 ? 5 : 6,
        current: level < 3 ? 2 : level < 6 ? 3 : level < 12 ? 4 : level < 17 ? 5 : 6,
      };
      break;

    case 'fighter':
      resources.actionSurge = {
        max: level >= 17 ? 2 : 1,
        current: level >= 17 ? 2 : 1,
      };
      break;

    case 'monk':
      if (level >= 2) {
        resources.kiPoints = { max: level, current: level };
      }
      break;

    case 'sorcerer':
      if (level >= 2) {
        resources.sorceryPoints = { max: level, current: level };
      }
      break;

    case 'bard':
      resources.bardic_inspiration = {
        max: level < 5 ? 2 : level < 15 ? 3 : 4,
        current: level < 5 ? 2 : level < 15 ? 3 : 4,
      };
      break;

    case 'cleric':
      if (level >= 2) {
        resources.channelDivinity = {
          max: level < 6 ? 1 : level < 18 ? 2 : 3,
          current: level < 6 ? 1 : level < 18 ? 2 : 3,
        };
      }
      break;

    case 'paladin':
      resources.layOnHands = { max: level * 5, current: level * 5 };
      if (level >= 2) {
        resources.channelDivinity = {
          max: level < 6 ? 1 : level < 18 ? 2 : 3,
          current: level < 6 ? 1 : level < 18 ? 2 : 3,
        };
      }
      break;
  }

  return resources;
}
