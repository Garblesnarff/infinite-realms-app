/**
 * useCombatActions Hook
 *
 * Encapsulates combat logic and action handlers for the CombatInterface.
 * Manages combat state transitions and validates actions using AI integration.
 */

import { useState, useCallback, useMemo } from 'react';

import type { ReactionOpportunity, CombatParticipant } from '@/types/combat';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useCombatActionHandlers } from '@/hooks/combat/use-combat-action-handlers';
import { useCombatMechanics } from '@/hooks/use-combat-mechanics';

export const useCombatActions = (_isDM: boolean = false) => {
  const { state, endCombat, nextTurn, refreshCombatState } = useCombat();

  const { state: characterState } = useCharacter();
  const { activeEncounter, isInCombat, showInitiativeTracker = false } = state;

  const [localShowInitiativeTracker, setLocalShowInitiativeTracker] =
    useState(showInitiativeTracker);

  const [selectedEnemy, setSelectedEnemy] = useState<string | null>(null);

  const [showCombatMode, setShowCombatMode] = useState(false);

  const playerCharacterId = characterState.character?.id;

  // Get player characters and potential enemies
  // ⚡ Bolt: Consolidated participant filtering and turn detection into a single useMemo with
  // a single O(N) pass to reduce hook overhead and eliminate redundant array iterations.
  const { playerParticipants, enemyParticipants, isPlayersTurn } = useMemo(() => {
    const players: CombatParticipant[] = [];
    const monsters: CombatParticipant[] = [];
    let playersTurn = false;

    if (activeEncounter?.participants) {
      for (const p of activeEncounter.participants) {
        if (p.participantType === 'player') players.push(p);
        else if (p.participantType === 'monster') monsters.push(p);

        if (
          activeEncounter.currentTurnParticipantId &&
          p.id === activeEncounter.currentTurnParticipantId &&
          p.characterId === playerCharacterId
        ) {
          playersTurn = true;
        }
      }
    }

    return {
      playerParticipants: players,
      enemyParticipants: monsters,
      isPlayersTurn: playersTurn,
    };
  }, [activeEncounter?.participants, activeEncounter?.currentTurnParticipantId, playerCharacterId]);

  // Handle ending combat
  const handleEndCombat = useCallback(async () => {
    await endCombat();
    setShowCombatMode(false);
    setSelectedEnemy(null);
  }, [endCombat]);

  // Extract handlers to modular hook
  const {
    actionValidation,
    reactionOpportunities,
    setReactionOpportunities,
    handleCombatAction,
    handleEnemyAttack,
    handleApplyDamage,
    handleHealing,
  } = useCombatActionHandlers({
    activeEncounter: activeEncounter || null,
    nextTurn,
    selectedEnemy,
    refreshCombatState,
  });

  const {
    showAdvantageModal,
    setShowAdvantageModal,
    pendingAttack,
    setPendingAttack,
    handleEnhancedAttack,
    handleClassFeature,
    handleDeathSave,
  } = useCombatMechanics({
    activeEncounter,
  });

  return {
    state,
    activeEncounter,
    isInCombat,
    playerParticipants,
    enemyParticipants,
    playerCharacterId,
    isPlayersTurn,
    selectedEnemy,
    setSelectedEnemy,
    showCombatMode,
    setShowCombatMode,
    actionValidation,
    reactionOpportunities,
    setReactionOpportunities: setReactionOpportunities as React.Dispatch<
      React.SetStateAction<ReactionOpportunity[]>
    >,
    localShowInitiativeTracker,
    setLocalShowInitiativeTracker,
    handleEndCombat,
    handleCombatAction,
    handleEnemyAttack,
    handleEnhancedAttack,
    handleClassFeature,
    handleDeathSave,
    handleApplyDamage,
    handleHealing,
    nextTurn,
    showAdvantageModal,
    setShowAdvantageModal,
    pendingAttack,
    setPendingAttack,
  };
};
