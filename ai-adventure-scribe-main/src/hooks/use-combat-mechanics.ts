import { useState, useCallback } from 'react';

import type { ActionType, CombatAction, CombatEncounter, CombatParticipant } from '@/types/combat';

import logger from '@/lib/logger';
import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';
import { calculateProficiencyBonus } from '@/utils/character-calculations';
import { getRageDamageBonus, canUseClassFeature } from '@/utils/classFeatures';
import { needsDeathSaves, rollDeathSave } from '@/utils/combat/deathSaves';
import { rollDice } from '@/utils/diceUtils';
import {
  createDefaultLightWeapons,
  equipMainHandWeapon,
  equipOffHandWeapon,
} from '@/utils/equipmentUtils';
import { canUseRacialTrait } from '@/utils/racialTraits';
import {
  canUseTwoWeaponFighting,
  makeMainHandAttack,
  canMakeOffHandAttack,
  makeOffHandAttack,
} from '@/utils/twoWeaponFighting';

interface UseCombatMechanicsProps {
  activeEncounter: CombatEncounter | null;
  handleCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    // Genuinely heterogeneous per-actionType payload that the implementation spreads
    // (...additionalData) into an object, which unknown can't support without narrowing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additionalData?: any,
  ) => Promise<void>;
  takeAction: (action: Partial<CombatAction>) => Promise<void>;
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
      _actionType: ActionType = 'attack',
      hasAdvantage: boolean = false,
      hasDisadvantage: boolean = false,
      _divineSmiteSlotLevel?: number, // Server support is required before this modifier can be accepted.
    ) => {
      if (!activeEncounter) return;

      if (!targetId) return;
      await executeAuthoritativeCombatIntent(activeEncounter.id, {
        type: 'attack', actorId: participantId, targetId,
        advantage: hasAdvantage, disadvantage: hasDisadvantage,
      });
    },
    [activeEncounter],
  );

  // Handle racial trait usage
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

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !participant.classFeatures || !participant.resources) return;

      const feature = participant.classFeatures.find((f) => f.name === featureName);
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

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !needsDeathSaves(participant)) return;

      const { updatedParticipant, roll } = rollDeathSave(participant);

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

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !participant.activeConcentration) return;

      const conMod = participant.abilityScores?.constitution?.modifier ?? 0;
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

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      // Equip default weapons if none equipped (for testing)
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

      // Main hand attack (action)
      const mainHandAttack = makeMainHandAttack(
        updatedParticipant,
        targetId || selectedEnemy || '',
      );
      await takeAction(mainHandAttack);

      // Off-hand attack (bonus action) - if bonus action available
      if (canMakeOffHandAttack(updatedParticipant)) {
        const offHandAttack = makeOffHandAttack(
          updatedParticipant,
          targetId || selectedEnemy || '',
        );
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
