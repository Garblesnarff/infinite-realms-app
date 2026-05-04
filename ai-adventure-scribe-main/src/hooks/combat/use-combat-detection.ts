import { useRef, useCallback } from 'react';

import type { CombatParticipant, CombatEncounter } from '@/types/combat';
import type { ChatMessage } from '@/types/game';
import type { CombatMessageData } from '@/utils/combat/ai-narration-utils';
import type { DetectedCombatAction, PlayerCharacterLike } from '@/utils/combatDetection';
import type { DiceRoll } from '@/utils/diceUtils';

import {
  getDamageRollForWeapon,
  createActionDescription,
} from '@/utils/combat/ai-narration-utils';
import { createCombatParticipantsFromDetection } from '@/utils/combat/participant-generation';
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
  sessionId,
  state,
  startCombat,
  endCombat,
}: UseCombatDetectionProps) => {
  const isStartingCombatRef = useRef(false);
  const hasInitiativeEmittedRef = useRef(false);
  const seenActionHashesRef = useRef<Set<string>>(new Set());
  const lastCombatEndAtRef = useRef<number>(0);

  const MIN_COMBAT_CONFIDENCE = Number(
    (import.meta as unknown as { env: Record<string, string> })?.env?.VITE_MIN_COMBAT_CONFIDENCE ??
      '0.55',
  );

  // Process DM response for combat content
  const processDMResponse = useCallback(
    async (
      dmMessage: ChatMessage,
      playerCharacter?: PlayerCharacterLike,
    ): Promise<{
      combatDetected: boolean;
      shouldStartCombat: boolean;
      shouldEndCombat: boolean;
      combatMessages: ChatMessage[];
    }> => {
      const detection = detectCombatFromText(dmMessage.text || '');
      const combatMessages: ChatMessage[] = [];

      // Handle combat ending
      if (detection.shouldEndCombat && state.activeEncounter) {
        await endCombat();
        hasInitiativeEmittedRef.current = false;
        seenActionHashesRef.current.clear();
        lastCombatEndAtRef.current = Date.now();
        return {
          combatDetected: true,
          shouldStartCombat: false,
          shouldEndCombat: true,
          combatMessages: [],
        };
      }

      // Handle combat starting with guard to prevent duplicates
      // Add cooldown check to prevent rapid re-triggers after combat ends
      const COMBAT_COOLDOWN_MS = 3000; // 3 seconds cooldown after combat ends
      const timeSinceLastEnd = Date.now() - (lastCombatEndAtRef.current || 0);
      const cooldownExpired = timeSinceLastEnd > COMBAT_COOLDOWN_MS;

      const canStartCombat =
        detection.shouldStartCombat && // Use new explicit initiative check from detection
        detection.confidence >= MIN_COMBAT_CONFIDENCE &&
        !!(detection.enemies && detection.enemies.length > 0) &&
        !state.isInCombat &&
        cooldownExpired; // Prevent rapid re-triggers

      if (canStartCombat && !isStartingCombatRef.current) {
        isStartingCombatRef.current = true;

        try {
          const participants = createCombatParticipantsFromDetection(
            detection.enemies,
            playerCharacter,
          );

          // Start combat with detected participants (CombatProvider rolls initiative)
          if (sessionId) {
            await startCombat(sessionId, participants as Partial<CombatParticipant>[]);

            // Create enhanced combat start message for UI log
            const initiativeText =
              participants.length > 1
                ? `${participants.length} combatants roll for initiative!`
                : `${participants[0]?.name || 'Fighter'} prepares for combat!`;

            const combatStartMessage: ChatMessage = {
              text: `⚔️ Combat has begun! ${initiativeText}\n\nInitiative order will be determined by d20 + DEX modifier.\nThe combat tracker will show turn order.`,
              sender: 'system',
              context: {
                combatData: {
                  type: 'initiative',
                  participants: participants.map((p) => ({
                    name: p.name || 'Unknown',
                    initiativeModifier: p.initiative || 0,
                  })),
                },
              },
              timestamp: new Date().toISOString(),
            };

            combatMessages.push(combatStartMessage);
            hasInitiativeEmittedRef.current = true;
            seenActionHashesRef.current.clear();
          }
        } finally {
          isStartingCombatRef.current = false;
        }
      }

      // Enforce mutual exclusivity between start/end hints to avoid contradictory logs
      let start = !!detection.shouldStartCombat;
      let end = !!detection.shouldEndCombat;
      if (start && end) {
        if (state.isInCombat) {
          start = false; // already in combat, prefer end
        } else {
          end = false; // out of combat, prefer start
        }
      }

      return {
        combatDetected: detection.isCombat,
        shouldStartCombat: start,
        shouldEndCombat: end,
        combatMessages,
      };
    },
    [state.activeEncounter, endCombat, state.isInCombat, MIN_COMBAT_CONFIDENCE, sessionId, startCombat],
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
