import { useCallback } from 'react';

import type { CombatParticipant, CombatEncounter } from '@/types/combat';
import type { ChatMessage } from '@/types/game';
import type { CombatMessageData } from '@/utils/combat/ai-narration-utils';
import type { DetectedCombatAction, PlayerCharacterLike } from '@/utils/combatDetection';
import type { DiceRoll } from '@/utils/diceUtils';

import { getDamageRollForWeapon, createActionDescription } from '@/utils/combat/ai-narration-utils';
import { detectCombatFromText } from '@/utils/combatDetection';
import { rollDice } from '@/utils/diceUtils';

interface UseCombatDetectionProps {
  sessionId?: string;
  state: {
    isInCombat: boolean;
    activeEncounter: CombatEncounter | null;
  };
  startCombat: (sessionId: string, participants: Partial<CombatParticipant>[]) => Promise<void>;
  endCombat: () => Promise<void>;
}

export const useCombatDetection = ({
  sessionId: _sessionId,
  state: _state,
  startCombat: _startCombat,
  endCombat: _endCombat,
}: UseCombatDetectionProps) => {
  // Legacy prose detection is telemetry-only. Structured combat_transition is
  // the sole authority for starting or ending combat.
  const processDMResponse = useCallback(
    async (
      dmMessage: ChatMessage,
      _playerCharacter?: PlayerCharacterLike,
    ): Promise<{
      combatDetected: boolean;
      shouldStartCombat: boolean;
      shouldEndCombat: boolean;
      combatMessages: ChatMessage[];
    }> => {
      const detection = detectCombatFromText(dmMessage.text || '');
      return {
        combatDetected: detection.isCombat,
        shouldStartCombat: false,
        shouldEndCombat: false,
        combatMessages: [],
      };
    },
    [],
  );

  // Create dice roll for a detected combat action
  const createCombatActionRoll = useCallback(
    async (action: DetectedCombatAction): Promise<CombatMessageData | null> => {
      let roll: DiceRoll;
      let dc: number | undefined;
      let success: boolean | undefined;
      let critical: boolean = false;

      switch (action.rollType) {
        case 'attack':
          // Attack roll (d20 + modifiers)
          roll = rollDice(20, 1, 5); // Base +5 attack bonus
          critical = roll.results[0] === 20;
          success = roll.total >= 15; // Assume AC 15 target
          dc = 15;
          break;

        case 'damage': {
          // Damage roll (weapon dependent)
          const damageRoll = action.weapon
            ? getDamageRollForWeapon(action.weapon)
            : { dice: 8, count: 1, modifier: 3 };
          roll = rollDice(damageRoll.dice, damageRoll.count, damageRoll.modifier);
          break;
        }

        case 'save':
          // Saving throw
          roll = rollDice(20, 1, 2); // Base +2 save bonus
          dc = 13; // Common save DC
          success = roll.total >= dc;
          break;

        case 'skill':
          // Skill check
          roll = rollDice(20, 1, 1); // Base +1 skill bonus
          dc = 12; // Common skill DC
          success = roll.total >= dc;
          break;

        default:
          return null;
      }

      const messageType =
        action.rollType === 'attack'
          ? 'attack_roll'
          : action.rollType === 'damage'
            ? 'damage_roll'
            : action.rollType === 'save'
              ? 'saving_throw'
              : 'skill_check';

      return {
        type: messageType,
        actor: action.actor,
        target: action.target,
        roll,
        dc,
        success,
        critical,
        action,
        description: createActionDescription(action, roll, success, critical),
      };
    },
    [],
  );

  return {
    processDMResponse,
    createCombatActionRoll,
  };
};
