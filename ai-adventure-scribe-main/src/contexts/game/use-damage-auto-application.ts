import { useEffect, useRef } from 'react';

import type { GameState } from './game-reducer';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * Custom hook to automatically apply damage from completed dice rolls to the player's HP.
 * Damage always goes through the server (POST /v1/characters/:id/damage) — the client
 * keeps no local HP copy (#621 Part A).
 */
export const useDamageAutoApplication = (
  state: GameState,
  characterId?: string | null,
  refreshCombatState?: () => Promise<void>,
): void => {
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

    // Apply each damage roll via the server route, in combat and out
    completedDamageRolls.forEach(async (roll) => {
      const damageAmount = roll.result?.total || 0;
      if (damageAmount > 0) {
        if (!characterId) {
          logger.error(
            `❌ Cannot apply damage_taken roll ${roll.id}: no characterId (damage of ${damageAmount} dropped)`,
          );
          return;
        }
        logger.info(
          `💔 Auto-applying damage_taken roll: ${damageAmount} ${roll.damageType || 'untyped'} damage to player via server`,
        );

        // Mark as applied to prevent double-application
        appliedDamageRollsRef.current.add(roll.id);

        try {
          await userDataApi.applyCharacterDamage(characterId, damageAmount, roll.damageType);
          logger.info(`✅ Applied ${damageAmount} damage to character HP via server`);
          // Refresh the combat tracker so it shows the new HP (#621 FIX).
          if (refreshCombatState) {
            try {
              await refreshCombatState();
            } catch (refreshError) {
              logger.error('❌ Failed to refresh combat state after damage:', refreshError);
            }
          }
        } catch (error) {
          appliedDamageRollsRef.current.delete(roll.id);
          logger.error('❌ Failed to persist damage:', error);
        }
      }
    });
  }, [state.diceRollQueue.pendingRolls, characterId]);
};
