import type { ConditionName } from '@/types/combat';
import type { ConditionDefinition } from '@/utils/condition-definitions';

export const combatModifiers: Partial<Record<ConditionName, ConditionDefinition>> = {
  blinded: {
    description:
      "Can't see enemies or allies. All attacks have disadvantage. Attacks against this creature have advantage.",
    getModifiers: (_participant, rollType) => {
      if (rollType === 'attack' || rollType === 'melee_attack' || rollType === 'ranged_attack') {
        // Attacker is blinded
        return {
          advantage: false,
          disadvantage: true,
          bonus: 0,
          autoFail: false,
          description: 'Blind - Disadvantage on attacks',
        };
      } else if (rollType === 'defense') {
        // Target is blinded (attacks against them get advantage)
        return {
          advantage: true,
          disadvantage: false,
          bonus: 0,
          autoFail: false,
          description: 'Blind - Advantage on attacks vs blinded target',
        };
      }
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: false,
        description: '',
      };
    },
    effect: [
      "Can't see enemies or allies",
      'All attacks have disadvantage',
      'Attacks against this creature have advantage',
    ],
  },

  charmed: {
    description:
      'Regards the charmer as a friendly acquaintance. Cannot target the charmer with attacks or damage.',
    getModifiers: (_participant, rollType, target) => {
      // Charmed creatures cannot attack their charmer
      // Note: This is a simplified implementation - in full D&D it would track who charmed them
      if (rollType === 'attack' && target?.participantType === 'player') {
        return {
          advantage: false,
          disadvantage: false,
          bonus: 0,
          autoFail: true,
          description: 'Charmed - Cannot attack charmer',
        };
      }
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: false,
        description: '',
      };
    },
    effect: ['Cannot attack charmer', 'Regards charmer as friendly', 'Cannot be harmed by charmer'],
  },

  deafened: {
    description: 'Cannot hear sounds. Automatically fails saving throws based on hearing.',
    getModifiers: (_participant, rollType) => {
      // Auto-fail saves that rely on hearing (some DM discretion needed)
      return rollType === 'hearing_dependent'
        ? {
            advantage: false,
            disadvantage: false,
            bonus: 0,
            autoFail: true,
            description: 'Deafened - Auto-fail hearing-based saves',
          }
        : {
            advantage: false,
            disadvantage: false,
            bonus: 0,
            autoFail: false,
            description: '',
          };
    },
    effect: ['Cannot hear sounds', 'Auto-fail hearing-based saves', 'Cannot understand speech'],
  },

  frightened: {
    description:
      'Afraid of a creature. Cannot willingly move closer to it. Attacks have disadvantage.',
    getModifiers: (_participant, rollType) => {
      return rollType === 'attack'
        ? {
            advantage: false,
            disadvantage: true,
            bonus: 0,
            autoFail: false,
            description: 'Frightened - Disadvantage on attacks',
          }
        : {
            advantage: false,
            disadvantage: false,
            bonus: 0,
            autoFail: false,
            description: '',
          };
    },
    effect: ['Cannot approach source of fear', 'Disadvantage on attacks and ability checks'],
  },

  invisible: {
    description:
      'Cannot be seen. Attacks have advantage. Attacks against this creature have disadvantage.',
    getModifiers: (_participant, rollType) => {
      if (rollType === 'attack') {
        // Invisible creature attacking - advantage
        return {
          advantage: true,
          disadvantage: false,
          bonus: 0,
          autoFail: false,
          description: 'Invisible - Advantage on attacks',
        };
      } else if (rollType === 'defense') {
        // Being attacked while invisible - disadvantage for attacker
        return {
          advantage: false,
          disadvantage: true,
          bonus: 0,
          autoFail: false,
          description: 'Invisible - Disadvantage on attacks vs target',
        };
      }
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: false,
        description: '',
      };
    },
    effect: ['Cannot be seen', 'Advantage on attacks', 'Attacks against target have disadvantage'],
  },

  poisoned: {
    description: 'Poisoned. Disadvantage on attack rolls and ability checks.',
    getModifiers: (_participant, rollType) => {
      return rollType === 'attack' || rollType === 'ability_check'
        ? {
            advantage: false,
            disadvantage: true,
            bonus: 0,
            autoFail: false,
            description: 'Poisoned - Disadvantage on attacks and checks',
          }
        : {
            advantage: false,
            disadvantage: false,
            bonus: 0,
            autoFail: false,
            description: '',
          };
    },
    effect: ['Disadvantage on attack rolls and ability checks'],
  },

  prone: {
    description: 'Lying down. Melee attacks have advantage. All attacks have disadvantage.',
    getModifiers: (_participant, rollType, target) => {
      if (rollType === 'melee_attack' && target) {
        // Attacking prone target
        return {
          advantage: true,
          disadvantage: false,
          bonus: 0,
          autoFail: false,
          description: 'Prone - Advantage on melee attacks vs prone target',
        };
      } else if (rollType === 'ranged_attack') {
        // Attacking while prone
        return {
          advantage: false,
          disadvantage: true,
          bonus: 0,
          autoFail: false,
          description: 'Prone - Disadvantage on ranged attacks',
        };
      }
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: false,
        description: '',
      };
    },
    effect: [
      'Melee attacks vs prone target have advantage',
      'Ranged attacks vs prone have disadvantage',
      'Can stand as half move',
    ],
  },
};
