/**
 * Combat Attack Handlers Hook
 * Extracts attack-related handlers from useCombatHandlers
 * for better modularity and testability.
 */

import { useCallback } from 'react';

import type { ActionType, CombatEncounter } from '@/types/combat';

import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { calculateAttackDamage } from '@/utils/attackUtils';
import { getRageDamageBonus } from '@/utils/classFeatures';
import { rollAttack } from '@/utils/diceUtils';
import {
  createDefaultLightWeapons,
  equipMainHandWeapon,
  equipOffHandWeapon,
} from '@/utils/equipmentUtils';
import {
  canUseTwoWeaponFighting,
  makeMainHandAttack,
  makeOffHandAttack,
  canMakeOffHandAttack,
} from '@/utils/twoWeaponFighting';

interface UseCombatAttackHandlersProps {
  activeEncounter: CombatEncounter | null;
  selectedEnemy: string | null;
  handleCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    additionalData?: any,
  ) => Promise<void>;
}

export function useCombatAttackHandlers({
  activeEncounter,
  selectedEnemy,
  handleCombatAction,
}: UseCombatAttackHandlersProps) {
  const { takeAction, nextTurn } = useCombat();

  /**
   * Handle enemy attack
   */
  const handleEnemyAttack = useCallback(
    async (attack: any) => {
      if (!selectedEnemy || !activeEncounter) return;

      const enemy = activeEncounter.participants.find((p) => p.id === selectedEnemy);
      if (!enemy) return;

      await handleCombatAction(
        'attack',
        selectedEnemy,
        activeEncounter.currentTurnParticipantId || '',
        {
          attackRoll: {
            total: Math.floor(Math.random() * 20) + 1 + (attack.attackBonus || 0),
            rolls: [Math.floor(Math.random() * 20) + 1],
            modifier: attack.attackBonus || 0,
          },
          damageRolls: attack.damageRoll ? [{ total: 0, rolls: [], modifier: 0 }] : [],
          damageType: attack.damageType,
          description: `${enemy.name} uses ${attack.name}`,
        },
      );

      setTimeout(() => nextTurn(), 1500);
    },
    [selectedEnemy, activeEncounter, handleCombatAction, nextTurn],
  );

  /**
   * Handle enhanced attack with advantage/disadvantage and Divine Smite
   */
  const handleEnhancedAttack = useCallback(
    async (
      participantId: string,
      targetId?: string,
      actionType: ActionType = 'attack',
      hasAdvantage: boolean = false,
      hasDisadvantage: boolean = false,
      divineSmiteSlotLevel?: number,
    ) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      const attackBonus = 5;
      const attackRoll = rollAttack(attackBonus, {
        advantage: hasAdvantage,
        disadvantage: hasDisadvantage,
        halflingLucky: participant.racialTraits?.some((t) => t.name === 'lucky') || false,
      });

      const isCritical = attackRoll.critical || false;

      const damageResult = calculateAttackDamage(
        { name: 'Longsword', damage: '1d8+3', damageType: 'slashing', properties: {} },
        participant,
        false,
        isCritical,
        undefined,
        activeEncounter,
        divineSmiteSlotLevel,
      );

      let damageRolls = [damageResult.baseDamageRoll];
      let totalDamage = damageResult.baseDamageRoll.reduce(
        (sum, roll) => sum + (roll.total || 0),
        0,
      );

      if (damageResult.sneakAttackRoll) {
        damageRolls = [...damageRolls, ...damageResult.sneakAttackRoll];
        totalDamage += damageResult.sneakAttackRoll.reduce(
          (sum, roll) => sum + (roll.total || 0),
          0,
        );
      }

      if (damageResult.divineSmiteRoll) {
        damageRolls = [...damageRolls, ...damageResult.divineSmiteRoll];
        totalDamage += damageResult.divineSmiteRoll.reduce(
          (sum, roll) => sum + (roll.total || 0),
          0,
        );
      }

      if (participant.isRaging && participant.characterClass === 'barbarian') {
        totalDamage += getRageDamageBonus(participant.level || 1);
      }

      const action = {
        participantId,
        targetParticipantId: targetId,
        actionType,
        description: `${participant.name} attacks${hasAdvantage ? ' with advantage' : hasDisadvantage ? ' with disadvantage' : ''}${isCritical ? ' - CRITICAL HIT!' : ''}`,
        attackRoll: {
          dieType: attackRoll.dieType,
          count: attackRoll.count,
          modifier: attackRoll.modifier,
          results: attackRoll.results,
          total: attackRoll.total,
          advantage: attackRoll.advantage,
          disadvantage: attackRoll.disadvantage,
          critical: attackRoll.critical,
          naturalRoll: attackRoll.naturalRoll,
        },
        damageRolls: damageRolls.map((roll) => ({
          dieType: roll.dieType,
          count: roll.count,
          modifier: roll.modifier,
          results: roll.results,
          total: roll.total,
        })),
        hit: attackRoll.total >= 15,
        damageDealt: totalDamage,
        damageType: 'slashing',
      };

      await handleCombatAction(actionType, participantId, targetId, action);
    },
    [activeEncounter, handleCombatAction],
  );

  /**
   * Handle two-weapon fighting
   */
  const handleTwoWeaponAttack = useCallback(
    async (participantId: string, targetId?: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      let updatedParticipant = participant;
      if (!participant.mainHandWeapon || !participant.offHandWeapon) {
        const weapons = createDefaultLightWeapons();
        updatedParticipant = equipMainHandWeapon(participant, weapons.scimitar);
        updatedParticipant = equipOffHandWeapon(updatedParticipant, weapons.shortsword);
      }

      if (!canUseTwoWeaponFighting(updatedParticipant)) {
        logger.warn('Cannot use two-weapon fighting');
        return;
      }

      const mainHandAttack = makeMainHandAttack(
        updatedParticipant,
        targetId || selectedEnemy || '',
      );
      await takeAction(mainHandAttack);

      if (canMakeOffHandAttack(updatedParticipant)) {
        const offHandAttack = makeOffHandAttack(
          updatedParticipant,
          targetId || selectedEnemy || '',
        );
        await takeAction(offHandAttack);
      }
    },
    [activeEncounter, takeAction, selectedEnemy],
  );

  return {
    handleEnemyAttack,
    handleEnhancedAttack,
    handleTwoWeaponAttack,
  };
}
