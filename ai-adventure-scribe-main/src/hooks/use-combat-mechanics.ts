import { useState, useCallback } from 'react';

import type { ActionType, CombatParticipant } from '@/types/combat';
import logger from '@/lib/logger';
import { calculateAttackDamage } from '@/utils/attackUtils';
import { getRageDamageBonus, canUseClassFeature } from '@/utils/classFeatures';
import { needsDeathSaves, rollDeathSave } from '@/utils/combat/deathSaves';
import { rollDice, rollAttack } from '@/utils/diceUtils';
import {
  createDefaultLightWeapons,
  equipMainHandWeapon,
  equipOffHandWeapon,
} from '@/utils/equipmentUtils';
import { calculateProficiencyBonus } from '@/utils/character-calculations';
import { canUseRacialTrait } from '@/utils/racialTraits';
import {
  canUseTwoWeaponFighting,
  makeMainHandAttack,
  canMakeOffHandAttack,
  makeOffHandAttack,
} from '@/utils/twoWeaponFighting';

interface UseCombatMechanicsProps {
  activeEncounter: any;
  handleCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    additionalData?: any,
  ) => Promise<void>;
  takeAction: (action: any) => Promise<void>;
  updateParticipant: (participantId: string, updates: Partial<CombatParticipant>) => void;
  selectedEnemy: string | null;
}

export const useCombatMechanics = ({
  activeEncounter,
  handleCombatAction,
  takeAction,
  updateParticipant,
  selectedEnemy,
}: UseCombatMechanicsProps) => {
  const [showAdvantageModal, setShowAdvantageModal] = useState(false);
  const [pendingAttack, setPendingAttack] = useState<{
    participantId: string;
    targetId?: string;
    actionType: ActionType;
    hasAdvantage?: boolean;
    hasDisadvantage?: boolean;
  } | null>(null);

  // Handle enhanced attack with optional Divine Smite
  const handleEnhancedAttack = useCallback(
    async (
      participantId: string,
      targetId?: string,
      actionType: ActionType = 'attack',
      hasAdvantage: boolean = false,
      hasDisadvantage: boolean = false,
      divineSmiteSlotLevel?: number, // For Paladin's Divine Smite
    ) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p: any) => p.id === participantId);
      if (!participant) return;

      // Roll attack with advantage/disadvantage
      const attackBonus = 5; // This would come from character stats
      const attackRoll = rollAttack(attackBonus, {
        advantage: hasAdvantage,
        disadvantage: hasDisadvantage,
        halflingLucky: participant.racialTraits?.some((t: any) => t.name === 'lucky') || false,
      });

      // Check for critical hit
      const isCritical = attackRoll.critical || false;

      // Calculate base damage with sneak attack and divine smite
      const damageResult = calculateAttackDamage(
        {
          name: 'Longsword',
          damage: { dice: '1d8+3', type: 'slashing' },
          properties: {}
        } as any,
        participant as any,
        isCritical,
        {
          divineSmiteLevel: divineSmiteSlotLevel,
          sneakAttack: false, // Logic for determining this could be added later
        },
      );

      const damageRolls = damageResult.rolls;
      let totalDamage = damageResult.totalBeforeResistance;

      // Ensure Rage damage is applied for Barbarians if not already included by calculateAttackDamage
      // The utility calculateAttackDamage normally handles this, but we keep this as a safety check
      if (participant.isRaging && (participant as any).characterClass === 'barbarian') {
        const hasRageBonus = damageResult.rolls.some((r: any) => r.isRageBonus);
        if (!hasRageBonus) {
          // If utility didn't add it (e.g. if it's an older version or different implementation),
          // we add it here using our class features utility.
          const rageBonus = getRageDamageBonus(participant.level || 1);
          totalDamage += rageBonus;
        }
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
        hit: attackRoll.total >= 15, // Would check against target AC
        damageDealt: totalDamage,
        damageType: 'slashing',
      };

      await handleCombatAction(actionType, participantId, targetId, action);
    },
    [activeEncounter, handleCombatAction],
  );

  // Handle racial trait usage
  const handleRacialTraitUse = useCallback(
    async (participantId: string, traitName: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p: any) => p.id === participantId);
      if (!participant || !participant.racialTraits) return;

      const trait = participant.racialTraits.find((t: any) => t.name === traitName);
      if (!trait || !canUseRacialTrait(trait)) return;

      let description = '';
      switch (trait.name) {
        case 'breath_weapon':
          description = `${participant.name} uses their breath weapon`;
          // Would trigger saving throw for targets
          break;
        case 'relentless_endurance':
          description = `${participant.name} drops to 1 hit point instead of 0`;
          break;
        default:
          description = `${participant.name} uses ${trait.name}`;
      }

      const action = {
        participantId,
        actionType: 'use_racial_trait' as ActionType,
        description,
        traitUsed: trait.name,
      };

      await handleCombatAction('bonus_action', participantId, undefined, action);
    },
    [activeEncounter, handleCombatAction],
  );

  // Handle class features
  const handleClassFeature = useCallback(
    async (participantId: string, featureName: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p: any) => p.id === participantId);
      if (!participant || !participant.classFeatures || !participant.resources) return;

      const feature = participant.classFeatures.find((f: any) => f.name === featureName);
      if (!feature || !canUseClassFeature(feature, participant.resources)) return;

      let description = '';
      let actionType: ActionType = 'use_class_feature' as ActionType;

      switch (feature.name) {
        case 'rage':
          // If already raging, deactivate rage
          if (participant.isRaging) {
            description = `${participant.name} stops raging`;
            actionType = 'end_rage' as ActionType;
          } else {
            description = `${participant.name} enters a rage`;
            actionType = 'use_class_feature' as ActionType;
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

      const action = {
        participantId,
        actionType,
        description,
        featureUsed: feature.name,
      };

      await handleCombatAction(actionType, participantId, undefined, action);
    },
    [activeEncounter, handleCombatAction],
  );

  // Handle death saving throw
  const handleDeathSave = useCallback(
    async (participantId: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p: any) => p.id === participantId);
      if (!participant || !needsDeathSaves(participant as any)) return;

      const { updatedParticipant, roll } = rollDeathSave(participant as any);

      // Update participant state
      updateParticipant(participantId, {
        deathSaves: updatedParticipant.deathSaves,
        isStable: updatedParticipant.isStable,
        isDead: updatedParticipant.isDead,
        currentHitPoints: updatedParticipant.currentHitPoints,
        isUnconscious: updatedParticipant.isUnconscious,
      });

      const description = `${participant.name} death save: ${roll.total} ${roll.total >= 10 ? '(Success)' : '(Failure)'} (${updatedParticipant.deathSaves.successes}/3, ${updatedParticipant.deathSaves.failures}/3)`;

      const action = {
        participantId,
        actionType: 'death_save' as ActionType,
        description,
        deathSaveResult: {
          roll: roll.total,
          result: roll.total >= 10 ? 'success' : 'failure',
          successes: updatedParticipant.deathSaves.successes,
          failures: updatedParticipant.deathSaves.failures,
          isStable: updatedParticipant.isStable,
          isDead: updatedParticipant.isDead,
          isCritical: roll.critical,
        },
      };

      await takeAction(action);
    },
    [activeEncounter, takeAction, updateParticipant],
  );

  // Handle concentration save
  const handleConcentrationSave = useCallback(
    async (participantId: string, dc: number) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p: any) => p.id === participantId);
      if (!participant || !(participant as any).activeConcentration) return;

      // Inline concentration save logic
      const conMod = (participant as any).abilityScores?.constitution?.modifier || 0;
      const proficiencyBonus = calculateProficiencyBonus(participant.level || 1);
      const saveBonus = conMod + proficiencyBonus; // Assuming proficiency in Con saves
      const rollResult = Math.floor(Math.random() * 20) + 1 + saveBonus;
      const succeeded = rollResult >= dc;
      const description = `${participant.name} makes concentration save: ${rollResult} ${succeeded ? '(Success)' : '(Failure)'}`;

      const action = {
        participantId,
        actionType: 'concentration_save' as ActionType,
        description,
        concentrationResult: {
          succeeded,
          roll: rollResult,
          dc,
          spellLost: !succeeded,
        },
      };

      if (!succeeded) {
        // Drop concentration
        updateParticipant(participantId, { activeConcentration: null });
      }

      await takeAction(action);
    },
    [activeEncounter, takeAction, updateParticipant],
  );

  // Handle two-weapon fighting attacks
  const handleTwoWeaponAttack = useCallback(
    async (participantId: string, targetId?: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p: any) => p.id === participantId);
      if (!participant) return;

      // Equip default weapons if none equipped (for testing)
      let updatedParticipant = participant;
      if (!participant.mainHandWeapon || !participant.offHandWeapon) {
        const weapons = createDefaultLightWeapons();
        updatedParticipant = equipMainHandWeapon(participant as any, weapons.scimitar) as any;
        updatedParticipant = equipOffHandWeapon(updatedParticipant as any, weapons.shortsword) as any;
      }

      if (!canUseTwoWeaponFighting(updatedParticipant as any)) {
        logger.warn('Cannot use two-weapon fighting');
        return;
      }

      // Main hand attack (action)
      const mainHandAttack = makeMainHandAttack(updatedParticipant as any, targetId || selectedEnemy || '');
      await takeAction(mainHandAttack);

      // Off-hand attack (bonus action) - if bonus action available
      if (canMakeOffHandAttack(updatedParticipant as any)) {
        const offHandAttack = makeOffHandAttack(updatedParticipant as any, targetId || selectedEnemy || '');
        await takeAction(offHandAttack);
      }
    },
    [activeEncounter, selectedEnemy, takeAction],
  );

  return {
    showAdvantageModal,
    setShowAdvantageModal,
    pendingAttack,
    setPendingAttack,
    handleEnhancedAttack,
    handleRacialTraitUse,
    handleClassFeature,
    handleDeathSave,
    handleConcentrationSave,
    handleTwoWeaponAttack,
  };
};
