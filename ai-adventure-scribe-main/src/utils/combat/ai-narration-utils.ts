import type { CombatEvent, ActionType } from '@/types/combat';
import type { DetectedCombatAction } from '@/utils/combatDetection';
import type { DiceRoll } from '@/utils/diceUtils';

/**
 * Extracted from use-combat-ai-integration.ts
 * Narrative formatting and trigger logic for Combat AI
 */

// Combat message data interface for dice rolls
export interface CombatMessageData {
  type:
    | 'attack_roll'
    | 'damage_roll'
    | 'saving_throw'
    | 'skill_check'
    | 'initiative'
    | 'death_save'
    | 'concentration_save';
  actor: string;
  target?: string;
  roll: DiceRoll;
  dc?: number;
  success?: boolean;
  critical?: boolean;
  action?: DetectedCombatAction;
  description: string;
}

// Get damage roll parameters for a weapon
export const getDamageRollForWeapon = (
  weapon: string,
): { dice: number; count: number; modifier: number } => {
  const weaponMap: Record<string, { dice: number; count: number; modifier: number }> = {
    sword: { dice: 8, count: 1, modifier: 3 },
    crossbow: { dice: 8, count: 1, modifier: 3 },
    bow: { dice: 6, count: 1, modifier: 3 },
    dagger: { dice: 4, count: 1, modifier: 3 },
    mace: { dice: 6, count: 1, modifier: 3 },
    claw: { dice: 4, count: 1, modifier: 2 },
    bite: { dice: 6, count: 1, modifier: 2 },
  };

  return weaponMap[weapon.toLowerCase()] || { dice: 6, count: 1, modifier: 2 };
};

// Create descriptive text for combat actions
export const createActionDescription = (
  action: DetectedCombatAction,
  roll: DiceRoll,
  success?: boolean,
  critical?: boolean,
): string => {
  const actor = action.actor;
  const target = action.target ? ` against ${action.target}` : '';
  const weapon = action.weapon ? ` with ${action.weapon}` : '';

  switch (action.rollType) {
    case 'attack':
      if (critical) {
        return `${actor} scores a critical hit${target}${weapon}!`;
      }
      return `${actor} ${success ? 'hits' : 'misses'}${target}${weapon}`;

    case 'damage':
      return `${actor} deals damage${target}${weapon}`;

    case 'save':
      return `${actor} makes a saving throw`;

    case 'skill':
      return `${actor} attempts a skill check`;

    default:
      return `${actor} performs ${action.action}${target}`;
  }
};

export function shouldTriggerDMNarration(event: CombatEvent, _encounter: unknown): boolean {
  const narrativeEvents = [
    'COMBAT_START',
    'COMBAT_END',
    'ROUND_START',
    'ACTION_TAKEN',
    'PARTICIPANT_UNCONSCIOUS',
    'PARTICIPANT_DEAD',
  ];

  return narrativeEvents.includes(event.type);
}

export function formatCombatEventForDM(event: CombatEvent): string {
  switch (event.type) {
    case 'COMBAT_START':
      return 'Combat has begun! Describe the opening moments of battle.';

    case 'COMBAT_END':
      return 'Combat has ended. Describe the aftermath and any consequences.';

    case 'ROUND_START':
      return `A new round of combat begins (Round ${event.roundNumber}). Describe the ongoing battle.`;

    case 'ACTION_TAKEN':
      if (event.action) {
        return `${event.action.description}. Provide dramatic narration for this combat action.`;
      }
      return 'An action was taken in combat. Provide appropriate narration.';

    case 'PARTICIPANT_UNCONSCIOUS':
      return 'A combatant has fallen unconscious! Describe this dramatic moment.';

    case 'PARTICIPANT_DEAD':
      return 'A combatant has died! Describe this pivotal moment in combat.';

    default:
      return 'Something significant happened in combat. Provide appropriate narration.';
  }
}

// Enhanced combat action types for better AI integration
export const combatActionPrompts: Record<ActionType, string> = {
  attack: 'Execute an attack with your weapon or natural ability',
  cast_spell: 'Cast a spell, considering components and spell slots',
  dash: 'Move additional distance, potentially changing battlefield position',
  dodge: 'Focus on avoiding attacks and staying defensive',
  help: 'Assist an ally with their next action or ability check',
  hide: 'Attempt to conceal yourself from enemies',
  ready: 'Prepare an action to trigger on a specific condition',
  search: 'Look for hidden enemies, objects, or environmental clues',
  use_object: 'Interact with an object or piece of equipment',
  bonus_action: 'Use a class feature, spell, or ability that requires a bonus action',
  reaction: 'Respond to a trigger with an immediate action',
  death_save: 'Make a death saving throw',
  concentration_save: 'Make a concentration saving throw',
  off_hand_attack: 'Make an off-hand attack',
  grapple: 'Attempt to grapple a target',
  shove: 'Attempt to shove a target',
  short_rest: 'Take a short rest to recover resources',
  long_rest: 'Take a long rest to recover all resources',
  use_racial_trait: 'Use a racial trait ability',
  use_class_feature: 'Use a class feature ability',
  divine_smite: 'Use Divine Smite with a spell slot',
};
