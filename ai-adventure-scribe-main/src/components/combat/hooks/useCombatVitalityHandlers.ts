/**
 * Combat Vitality Handlers Hook
 * Extracts HP, damage, and status related handlers from useCombatHandlers
 * for better modularity and testability.
 */

import { useCallback } from 'react';

import type {
  ActionType,
  CombatEncounter,
  CombatParticipant,
} from '@/types/combat';

import { useCombat } from '@/contexts/CombatContext';
import { calculateProficiencyBonus } from '@/utils/character-calculations';
import { rollDeathSave, needsDeathSaves } from '@/utils/combat/deathSaves';
import { checkConcentration } from '@/utils/spell-management';

interface UseCombatVitalityHandlersProps {
  activeEncounter: CombatEncounter | null;
}

export function useCombatVitalityHandlers({
  activeEncounter,
}: UseCombatVitalityHandlersProps): {
  handleDeathSave: (participantId: string) => Promise<void>;
  handleConcentrationSave: (participantId: string, dc: number) => Promise<void>;
  handleApplyDamage: (
    participantId: string,
    damageAmount: number,
    damageType: string,
  ) => Promise<void>;
  handleHealing: (participantId: string, healingAmount: number) => Promise<void>;
} {
  const { takeAction, updateParticipant } = useCombat();

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
    handleDeathSave,
    handleConcentrationSave,
    handleApplyDamage,
    handleHealing,
  };
}
