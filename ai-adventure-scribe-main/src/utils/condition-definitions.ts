import type { CombatParticipant, Condition, ConditionName } from '@/types/combat';

// ===========================
// Condition Effect Definitions
// ===========================

export interface ConditionModifiers {
  advantage: boolean;
  disadvantage: boolean;
  bonus: number;
  autoFail: boolean;
  description: string;
}

export interface ConditionDefinition {
  description: string;
  getModifiers: (
    participant: CombatParticipant,
    rollType: string,
    target?: CombatParticipant,
  ) => ConditionModifiers;
  onApply?: (participant: CombatParticipant, condition: Condition) => CombatParticipant;
  onRemove?: (participant: CombatParticipant, condition: Condition) => CombatParticipant;
  effect: string[];
}

// Core condition effects mapping
export const CONDITION_EFFECTS: Record<ConditionName, ConditionDefinition> = {
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
