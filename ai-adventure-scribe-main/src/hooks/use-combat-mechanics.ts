import { useState, useCallback } from 'react';

import type { ActionType, CombatEncounter } from '@/types/combat';

import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';
import { canUseClassFeature } from '@/utils/classFeatures';
import { needsDeathSaves } from '@/utils/combat/deathSaves';

interface UseCombatMechanicsProps {
  activeEncounter: CombatEncounter | null;
}

export const useCombatMechanics = ({ activeEncounter }: UseCombatMechanicsProps) => {
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
      divineSmiteSlotLevel?: number,
    ) => {
      if (!activeEncounter) return;

      if (!targetId) return;
      // #1362: the server spends the slot and rolls the Smite only if this attack hits.
      await executeAuthoritativeCombatIntent(activeEncounter.id, {
        type: 'attack',
        actorId: participantId,
        targetId,
        advantage: hasAdvantage,
        disadvantage: hasDisadvantage,
        ...(divineSmiteSlotLevel !== undefined ? { divineSmiteSlotLevel } : {}),
      });
    },
    [activeEncounter],
  );

  // Handle class features. Second Wind, Action Surge and Divine Sense are the only features with a
  // server intent (#621 B2b). The server spends the use and rolls the heal. Any other feature has no
  // server intent, so it does nothing here (#621 B2b step 2).
  const handleClassFeature = useCallback(
    async (participantId: string, featureName: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !participant.classFeatures || !participant.resources) return;

      const feature = participant.classFeatures.find((f) => f.name === featureName);
      if (!feature || !canUseClassFeature(feature, participant.resources)) return;

      // The body matches the option the DM panel posts.
      if (
        feature.name !== 'second_wind' &&
        feature.name !== 'action_surge' &&
        feature.name !== 'divine_sense'
      ) {
        return;
      }
      await executeAuthoritativeCombatIntent(
        activeEncounter.id,
        { type: feature.name, actorId: participantId },
        'dm',
        Date.now(),
        'typed',
      );
    },
    [activeEncounter],
  );

  // Handle death saving throw — via the server's authoritative intent, not a local
  // roll. The engine owns the tallies; a local roll never reaches it (#261).
  const handleDeathSave = useCallback(
    async (participantId: string) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant || !needsDeathSaves(participant)) return;

      await executeAuthoritativeCombatIntent(
        activeEncounter.id,
        { type: 'death_save', actorId: participantId },
        'player',
        undefined,
        'action_bar',
      );
    },
    [activeEncounter],
  );

  return {
    showAdvantageModal,
    setShowAdvantageModal,
    pendingAttack,
    setPendingAttack,
    handleEnhancedAttack,
    handleClassFeature,
    handleDeathSave,
  };
};
