import type { ConditionName } from '@/types/combat';
import type { ConditionDefinition } from '@/utils/condition-definitions';

export const incapacitatingConditions: Partial<Record<ConditionName, ConditionDefinition>> = {
  incapacitated: {
    description: 'Cannot take actions, speak, or communicate. Unable to respond.',
    getModifiers: (_participant, _rollType) => {
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: true, // Cannot take most actions
        description: 'Incapacitated - Cannot take actions',
      };
    },
    effect: ['Cannot take actions', 'Cannot speak', 'Cannot respond to stimuli'],
  },

  paralyzed: {
    description: 'Cannot move, speak, or take actions. Auto-fails DEX and STR saves.',
    getModifiers: (_participant, rollType) => {
      const dexAndStrSaves = rollType === 'dexterity_save' || rollType === 'strength_save';
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: dexAndStrSaves,
        description: dexAndStrSaves
          ? 'Paralyzed - Auto-fail DEX/STR saves'
          : 'Paralyzed - Cannot move or act',
      };
    },
    effect: [
      'Cannot move, speak, or take actions',
      'Auto-fail DEX and STR saves',
      'Critical hits automatically hit',
    ],
  },

  petrified: {
    description: 'Turned to stone. Cannot move, speak, or take actions. Unconscious.',
    getModifiers: (_participant, _rollType) => {
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: true, // Effectively unconscious
        description: 'Petrified - Cannot move or act',
      };
    },
    effect: [
      'Turned to stone',
      'Cannot move, speak, or take actions',
      'Weight increases',
      'Becomes unconscious',
    ],
  },

  stunned: {
    description: 'Dazed and disoriented. Cannot take actions. Auto-fails DEX and STR saves.',
    getModifiers: (_participant, rollType) => {
      const dexAndStrSaves = rollType === 'dexterity_save' || rollType === 'strength_save';
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: dexAndStrSaves,
        description: dexAndStrSaves
          ? 'Stunned - Auto-fail DEX/STR saves'
          : 'Stunned - Cannot take actions',
      };
    },
    effect: [
      'Cannot take actions',
      'Auto-fail DEX and STR saves',
      'Cannot move',
      'Ignores effects that require attention',
    ],
  },

  unconscious: {
    description: 'Unconscious and unable to act. Defenseless.',
    getModifiers: (_participant, rollType) => {
      if (rollType === 'defense') {
        return {
          advantage: false,
          disadvantage: true,
          bonus: 0,
          autoFail: false,
          description: 'Unconscious - Auto-fail saves, critical hits automatically hit',
        };
      }
      return {
        advantage: false,
        disadvantage: false,
        bonus: 0,
        autoFail: true, // Cannot take most actions
        description: 'Unconscious - Cannot act',
      };
    },
    effect: [
      'Unconscious and unaware',
      'Auto-fail saves',
      'Critical hits automatically hit',
      'Cannot take actions',
    ],
  },

  exhaustion: {
    description: 'Exhausted from pushing beyond normal limits. Effects increase with level (1-6).',
    getModifiers: (participant, rollType) => {
      const exhaustionLevel =
        participant.conditions.find((c) => c.name === 'exhaustion')?.level || 0;

      // Level 3 or higher gives disadvantage on attacks and saves
      if (exhaustionLevel >= 3 && (rollType === 'attack' || rollType === 'save')) {
        return {
          advantage: false,
          disadvantage: true,
          bonus: 0,
          autoFail: false,
          description: `Exhaustion level ${exhaustionLevel} - Disadvantage on attacks and saves`,
        };
      }

      // Level 1 or higher gives disadvantage on ability checks
      if (exhaustionLevel >= 1 && rollType === 'ability_check') {
        return {
          advantage: false,
          disadvantage: true,
          bonus: 0,
          autoFail: false,
          description: `Exhaustion level ${exhaustionLevel} - Disadvantage on ability checks`,
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
    // Exhaustion doesn't have special onApply effects like speed reduction
    // These are handled by external calculations
    effect: [
      'Level 1+: Disadvantage on ability checks',
      'Level 3+: Disadvantage on attacks and saves',
      'Level 2+: Speed halved',
      'Level 4+: Hit point max halved',
      'Level 5+: Speed reduced to 0',
      'Level 6+: Death',
    ],
  },
};
