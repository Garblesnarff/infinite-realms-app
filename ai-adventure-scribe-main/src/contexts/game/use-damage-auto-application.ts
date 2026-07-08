import { useEffect, useRef } from 'react';

import type { GameState } from './game-reducer';
import type { CombatState, DamageType } from '@/types/combat';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * Custom hook to automatically apply damage from completed dice rolls to the player's HP.
 * This bridges the AI DM's damage requests with the combat HP system.
 *
 * Extracted from GameContext.tsx to reduce monolithic complexity.
 */
export const useDamageAutoApplication = (
  state: GameState,
  combatState: CombatState,
  dealDamage: (participantId: string, damage: number, damageType?: DamageType) => Promise<void>,
  characterId?: string | null,
) => {
  // Track which damage_taken rolls have been applied to prevent double-application
  const appliedDamageRollsRef = useRef<Set<string>>(new Set());

  /**
   * Auto-apply damage_taken rolls to player HP when they complete
   */
  useEffect(() => {
    // Find completed damage_taken rolls that haven't been applied yet
    const completedDamageRolls = state.diceRollQueue.pendingRolls.filter(
      (roll) =>
        roll.requestType === 'damage_taken' &&
        roll.status === 'completed' &&
        roll.target === 'player' &&
        roll.result?.total &&
        !appliedDamageRollsRef.current.has(roll.id),
    );

    // Apply each damage roll
    completedDamageRolls.forEach(async (roll) => {
      const damageAmount = roll.result?.total || 0;
      if (damageAmount > 0) {
        logger.info(
          `💔 Auto-applying damage_taken roll: ${damageAmount} ${roll.damageType || 'untyped'} damage to player`,
        );

        // Mark as applied to prevent double-application
        appliedDamageRollsRef.current.add(roll.id);

        // If in combat, apply via CombatContext
        if (combatState.isInCombat && combatState.activeEncounter) {
          // Find player participant
          const playerParticipant = combatState.activeEncounter.participants.find(
            (p) => p.participantType === 'player',
          );
          if (playerParticipant) {
            logger.info(
              `⚔️ Applying ${damageAmount} damage to ${playerParticipant.name} in combat via dealDamage`,
            );
            try {
              await dealDamage(playerParticipant.id, damageAmount, roll.damageType);
              logger.info(`✅ Damage applied successfully to ${playerParticipant.name}`);
            } catch (error) {
              logger.error(`❌ Failed to apply damage:`, error);
            }
          }
        } else if (characterId) {
          try {
            await userDataApi.applyCharacterDamage(characterId, damageAmount);
            logger.info(`✅ Applied ${damageAmount} out-of-combat damage to character HP`);
          } catch (error) {
            appliedDamageRollsRef.current.delete(roll.id);
            logger.error('❌ Failed to persist out-of-combat damage:', error);
          }
        }
      }
    });
  }, [
    state.diceRollQueue.pendingRolls,
    combatState.isInCombat,
    combatState.activeEncounter,
    dealDamage,
    characterId,
  ]);
};
