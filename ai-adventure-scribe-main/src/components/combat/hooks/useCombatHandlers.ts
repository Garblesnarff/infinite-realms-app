/**
 * Combat Interface Handlers Hook
 * Extracts combat action handlers from CombatInterface component
 * for better modularity and testability
 */

import { useCallback } from 'react';
import type {
  ActionType,
  CombatEncounter,
  CombatParticipant,
  ReactionOpportunity,
} from '@/types/combat';
import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { calculateAttackDamage } from '@/utils/attackUtils';
import { canUseClassFeature, getRageDamageBonus } from '@/utils/classFeatures';
import { rollDeathSave, needsDeathSaves } from '@/utils/combat/deathSaves';
import { rollDice, rollAttack } from '@/utils/diceUtils';
import { calculateProficiencyBonus } from '@/utils/character-calculations';
import {
  createDefaultLightWeapons,
  equipMainHandWeapon,
  equipOffHandWeapon,
} from '@/utils/equipmentUtils';
import { canUseRacialTrait } from '@/utils/racialTraits';
import { processReactionResponse } from '@/utils/reactionSystem';
import { checkConcentration } from '@/utils/spell-management';
import {
  canUseTwoWeaponFighting,
  makeMainHandAttack,
  makeOffHandAttack,
  canMakeOffHandAttack,
} from '@/utils/twoWeaponFighting';

interface UseCombatHandlersProps {
  activeEncounter: CombatEncounter | null;
  selectedEnemy: string | null;
  validateCombatAction: (action: any, participant: any) => Promise<any>;
  setActionValidation: (validation: any) => void;
  setReactionOpportunities: React.Dispatch<React.SetStateAction<ReactionOpportunity[]>>;
}

export function useCombatHandlers({
  activeEncounter,
  selectedEnemy,
  validateCombatAction,
  setActionValidation,
  setReactionOpportunities,
}: UseCombatHandlersProps) {
  const { takeAction, updateParticipant, nextTurn } = useCombat();

  /**
   * Validate and execute combat action
   */
  const handleCombatAction = useCallback(
    async (
      actionType: ActionType,
      participantId: string,
      targetId?: string,
      additionalData?: any,
    ) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      const action = {
        participantId,
        targetParticipantId: targetId,
        actionType,
        description: `${participant.name} attempts to ${actionType}`,
        ...additionalData,
      };

      try {
        const validation = await validateCombatAction(action, participant);
        setActionValidation(validation);

        if (!validation.isValid) {
          logger.warn('Invalid combat action:', validation.errors);
          return;
        }

        await takeAction(action);
        setActionValidation(null);
      } catch (error) {
        logger.error('Error validating combat action:', error);
        await takeAction(action);
      }
    },
    [activeEncounter, takeAction, validateCombatAction, setActionValidation],
  );

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
   * Handle racial trait usage
   */
  const handleRacialTraitUse = useCallback(
    async (participantId: string, traitName: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !participant.racialTraits) return;

      const trait = participant.racialTraits.find((t) => t.name === traitName);
      if (!trait || !canUseRacialTrait(trait)) return;

      let description = '';
      switch (trait.name) {
        case 'breath_weapon':
          description = `${participant.name} uses their breath weapon`;
          break;
        case 'relentless_endurance':
          description = `${participant.name} drops to 1 hit point instead of 0`;
          break;
        default:
          description = `${participant.name} uses ${trait.name}`;
      }

      await handleCombatAction('bonus_action', participantId, undefined, {
        participantId,
        actionType: 'use_racial_trait' as ActionType,
        description,
        traitUsed: trait.name,
      });
    },
    [activeEncounter, handleCombatAction],
  );

  /**
   * Handle class feature usage
   */
  const handleClassFeature = useCallback(
    async (participantId: string, featureName: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !participant.classFeatures || !participant.resources) return;

      const feature = participant.classFeatures.find((f) => f.name === featureName);
      if (!feature || !canUseClassFeature(feature, participant.resources)) return;

      let description = '';
      let actionType: ActionType = 'use_class_feature' as ActionType;

      switch (feature.name) {
        case 'rage':
          if (participant.isRaging) {
            description = `${participant.name} stops raging`;
            actionType = 'end_rage' as ActionType;
          } else {
            description = `${participant.name} enters a rage`;
          }
          break;
        case 'action_surge':
          description = `${participant.name} uses Action Surge for an additional action`;
          actionType = 'action_surge' as ActionType;
          break;
        case 'second_wind': {
          const healing = rollDice(10, 1, participant.level || 1);
          description = `${participant.name} uses Second Wind to heal ${healing.total} hit points`;
          actionType = 'second_wind' as ActionType;
          break;
        }
        default:
          description = `${participant.name} uses ${feature.name}`;
      }

      await handleCombatAction(actionType, participantId, undefined, {
        participantId,
        actionType,
        description,
        featureUsed: feature.name,
      });
    },
    [activeEncounter, handleCombatAction],
  );

  /**
   * Handle reaction opportunity response
   */
  const handleReactionOpportunity = useCallback(
    async (opportunity: ReactionOpportunity, selectedReaction: ActionType) => {
      if (!activeEncounter) return;

      try {
        const reactionAction = processReactionResponse(
          opportunity,
          selectedReaction,
          activeEncounter,
        );
        await takeAction(reactionAction);

        const participant = activeEncounter.participants.find(
          (p) => p.id === opportunity.participantId,
        );
        if (participant) {
          updateParticipant(opportunity.participantId, { reactionTaken: true });
        }

        setReactionOpportunities((prev) => prev.filter((opp) => opp.id !== opportunity.id));
      } catch (error) {
        logger.error('Error processing reaction:', error);
      }
    },
    [activeEncounter, takeAction, updateParticipant, setReactionOpportunities],
  );

  /**
   * Handle death saving throw
   */
  const handleDeathSave = useCallback(
    async (participantId: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !needsDeathSaves(participant)) return;

      const { updatedParticipant, roll } = rollDeathSave(participant);

      updateParticipant(participantId, {
        deathSaves: updatedParticipant.deathSaves,
        isStable: updatedParticipant.isStable,
        isDead: updatedParticipant.isDead,
        currentHitPoints: updatedParticipant.currentHitPoints,
        isUnconscious: updatedParticipant.isUnconscious,
      });

      await takeAction({
        participantId,
        actionType: 'death_save' as ActionType,
        description: `${participant.name} death save: ${roll.total} ${roll.total >= 10 ? '(Success)' : '(Failure)'} (${updatedParticipant.deathSaves.successes}/3, ${updatedParticipant.deathSaves.failures}/3)`,
        deathSaveResult: {
          roll: roll.total,
          result: roll.total >= 10 ? 'success' : 'failure',
          successes: updatedParticipant.deathSaves.successes,
          failures: updatedParticipant.deathSaves.failures,
          isStable: updatedParticipant.isStable,
          isDead: updatedParticipant.isDead,
          isCritical: roll.critical,
        },
      });
    },
    [activeEncounter, takeAction, updateParticipant],
  );

  /**
   * Handle concentration save
   */
  const handleConcentrationSave = useCallback(
    async (participantId: string, dc: number) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !(participant as any).activeConcentration) return;

      const conMod = (participant as any).abilityScores?.constitution?.modifier || 0;
      const proficiencyBonus = calculateProficiencyBonus(participant.level || 1);
      const saveBonus = conMod + proficiencyBonus;
      const rollResult = Math.floor(Math.random() * 20) + 1 + saveBonus;
      const succeeded = rollResult >= dc;

      if (!succeeded) {
        participant.activeConcentration = null;
      }

      await takeAction({
        participantId,
        actionType: 'concentration_save' as ActionType,
        description: `${participant.name} makes concentration save: ${rollResult} ${succeeded ? '(Success)' : '(Failure)'}`,
        concentrationResult: { succeeded, roll: rollResult, dc, spellLost: !succeeded },
      });
    },
    [activeEncounter, takeAction],
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

  /**
   * Handle applying direct damage
   */
  const handleApplyDamage = useCallback(
    async (participantId: string, damageAmount: number, damageType: string) => {
      if (!activeEncounter) return;
      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      const newHP = Math.max(0, (participant.currentHitPoints || 0) - damageAmount);
      const isUnconscious = newHP <= 0;

      let concentrationLost = false;
      if (participant.activeConcentration && damageAmount > 0) {
        concentrationLost = !checkConcentration(participant as any, damageAmount);
      }

      const updatedProps: Partial<CombatParticipant> = {
        currentHitPoints: newHP,
        isUnconscious,
      };

      if (concentrationLost) {
        updatedProps.activeConcentration = null;
      }

      if (isUnconscious && (participant.currentHitPoints || 0) > 0) {
        updatedProps.isStable = false;
        updatedProps.deathSaves = { successes: 0, failures: 0 };
      }

      updateParticipant(participantId, updatedProps);

      await takeAction({
        participantId,
        actionType: 'damage_dealt' as ActionType,
        description: `${participant.name} takes ${damageAmount} ${damageType} damage.`,
        damageDealt: damageAmount,
        damageType: damageType as any,
        effects: { newHitPoints: newHP, unconscious: isUnconscious, concentrationLost },
      });
    },
    [activeEncounter, takeAction, updateParticipant],
  );

  /**
   * Handle healing
   */
  const handleHealing = useCallback(
    async (participantId: string, healingAmount: number) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      const maxHP = participant.maxHitPoints || 1;
      const newHP = Math.min(maxHP, (participant.currentHitPoints || 0) + healingAmount);
      const wasUnconscious = (participant.currentHitPoints || 0) <= 0;
      const revived = wasUnconscious && newHP > 0;

      updateParticipant(participantId, {
        currentHitPoints: newHP,
        isUnconscious: (newHP <= 0) as any,
      } as any);

      await takeAction({
        participantId,
        actionType: 'heal' as ActionType,
        description: `${participant.name} heals ${healingAmount} hit points${revived ? ' and regains consciousness' : ''}`,
        healingAmount,
        effects: { revivedFromUnconscious: revived, newHitPoints: newHP },
      });
    },
    [activeEncounter, takeAction, updateParticipant],
  );

  return {
    handleCombatAction,
    handleEnemyAttack,
    handleEnhancedAttack,
    handleRacialTraitUse,
    handleClassFeature,
    handleReactionOpportunity,
    handleDeathSave,
    handleConcentrationSave,
    handleTwoWeaponAttack,
    handleApplyDamage,
    handleHealing,
  };
}
