import type { ConditionName } from '@/types/combat';
import type { ConditionDefinition } from '@/utils/condition-definitions';

export const movementModifiers: Partial<Record<ConditionName, ConditionDefinition>> = {
  grappled: {
    description: 'Restrained by a grappler. Speed becomes 0. Cannot move.',
    getModifiers: (_participant, _rollType) => {
      // Grappling affects movement primarily (handled in other systems)
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: false,
        description: 'Grappled - Speed 0, cannot move',
      };
    },
    onApply: (participant, condition) => {
      return {
        ...participant,
        movementUsed: participant.speed, // Effectively 0 speed
        conditions: [...participant.conditions, condition],
      };
    },
    effect: ['Speed becomes 0', 'Cannot move', 'Can break free with Athletics or Acrobatics'],
  },

  restrained: {
    description: 'Restrained. Speed 0. Attacks have advantage. Auto-fail DEX saves.',
    getModifiers: (_participant, rollType) => {
      if (rollType === 'defense') {
        return {
          advantage: false,
          disadvantage: true,
          bonus: 0,
          autoFail: false,
          description: 'Restrained - Disadvantage on defense',
        };
      } else if (rollType === 'dexterity_save') {
        return {
          advantage: false,
          disadvantage: false,
          bonus: 0,
          autoFail: true,
          description: 'Restrained - Auto-fail DEX saves',
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
    onApply: (participant, condition) => {
      return {
        ...participant,
        movementUsed: participant.speed, // Speed = 0
        conditions: [...participant.conditions, condition],
      };
    },
    effect: ['Speed becomes 0', 'Attacks have advantage vs restrained', 'Auto-fail DEX saves'],
  },

  surprised: {
    description: 'Caught unawares. Cannot take an action this turn.',
    getModifiers: (_participant, _rollType) => {
      // The main effect of surprise is already handled by turn logic
      // But we can add any remaining modifiers here
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: false,
        description: 'Surprised - Cannot take actions this turn',
      };
    },
    effect: [
      "Can't take an action on first turn",
      'Attacks against surprised creatures have advantage',
    ],
  },
};
