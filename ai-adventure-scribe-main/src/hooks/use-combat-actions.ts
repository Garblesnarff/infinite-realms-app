/**
 * useCombatActions Hook
 *
 * Encapsulates combat logic and action handlers for the CombatInterface.
 * Manages combat state transitions and validates actions using AI integration.
 */

import { useState, useCallback, useMemo } from 'react';

import type { ActionType, ReactionOpportunity, CombatParticipant } from '@/types/combat';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useCombatAIIntegration } from '@/hooks/use-combat-ai-integration';
import { useCombatMechanics } from '@/hooks/use-combat-mechanics';
import { useGameSession } from '@/hooks/use-game-session';
import logger from '@/lib/logger';
import { processReactionResponse } from '@/utils/reactionSystem';
import { checkConcentration } from '@/utils/spell-management';

export const useCombatActions = (_isDM: boolean = false) => {
  const {
    state,
    startCombat,
    endCombat,
    nextTurn,
    rollInitiative,
    takeAction,
    addParticipant,
    updateParticipant,
  } = useCombat();

  const { sessionId } = useGameSession();
  const { state: characterState } = useCharacter();
  const { validateCombatAction } = useCombatAIIntegration({
    sessionId,
    characterId: characterState.character?.id,
    campaignId: undefined, // Will be passed from parent if needed
  });

  const { activeEncounter, isInCombat, showInitiativeTracker = false } = state;

  const [localShowInitiativeTracker, setLocalShowInitiativeTracker] =
    useState(showInitiativeTracker);

  const [selectedEnemy, setSelectedEnemy] = useState<string | null>(null);

  const [showCombatMode, setShowCombatMode] = useState(false);
  const [isStartingCombat, setIsStartingCombat] = useState(false);
  const [actionValidation, setActionValidation] = useState<{
    isValid: boolean;
    suggestions: string[];
    errors: string[];
  } | null>(null);
  const [reactionOpportunities, setReactionOpportunities] = useState<ReactionOpportunity[]>([]);

  // Get player characters and potential enemies
  // ⚡ Bolt: Memoize participant lists and turn state to prevent redundant filtering and calculations on every render.
  const playerParticipants = useMemo(
    () => activeEncounter?.participants.filter((p) => p.participantType === 'player') || [],
    [activeEncounter?.participants],
  );

  const enemyParticipants = useMemo(
    () => activeEncounter?.participants.filter((p) => p.participantType === 'monster') || [],
    [activeEncounter?.participants],
  );

  const playerCharacterId = characterState.character?.id;

  const isPlayersTurn = useMemo(
    () =>
      Boolean(
        activeEncounter?.currentTurnParticipantId &&
        activeEncounter.participants.find((p) => p.id === activeEncounter.currentTurnParticipantId)
          ?.characterId === playerCharacterId,
      ),
    [activeEncounter?.currentTurnParticipantId, activeEncounter?.participants, playerCharacterId],
  );

  // Handle starting combat
  const handleStartCombat = useCallback(async () => {
    if (!isStartingCombat && playerParticipants.length > 0) {
      setIsStartingCombat(true);

      // Create basic combat encounter with current participants
      const combatParticipants = [...playerParticipants, ...enemyParticipants].map((p) => ({
        id: p.id,
        participantType: p.participantType,
        name: p.name,
        characterId: p.characterId,
        initiative: 0, // Will be rolled automatically
        armorClass: p.armorClass,
        maxHitPoints: p.maxHitPoints,
        currentHitPoints: p.currentHitPoints,
        temporaryHitPoints: p.temporaryHitPoints || 0,
        position: (p as any).position || { x: 0, y: 0 },
        conditions: p.conditions || [],
        deathSaves: p.deathSaves || { successes: 0, failures: 0, isStable: false },
        actionTaken: false,
        bonusActionTaken: false,
        reactionTaken: false,
        movementUsed: 0,
        monsterData: (p as any).monsterData,
        spellSlots: p.spellSlots,
        activeConcentration: p.activeConcentration,
        abilityScores: (p as any).abilityScores || {},
        isUnconscious: false,
        isDead: false,
        isStable: false,
        visionTypes: (p as any).visionTypes || ['normal'],
        fightingStyles: (p as any).fightingStyles || [],
        racialTraits: (p as any).racialTraits || [],
        classFeatures: (p as any).classFeatures || [],
        resources: (p as any).resources || {},
        characterClass: (p as any).characterClass || '',
        isRaging: false,
        cover: (p as any).cover || { type: 'none' },
      })) as any[];

      await startCombat('current-session', combatParticipants);
      setShowCombatMode(true);
      setIsStartingCombat(false);
    }
  }, [isStartingCombat, playerParticipants, enemyParticipants, startCombat]);

  // Handle ending combat
  const handleEndCombat = useCallback(async () => {
    await endCombat();
    setShowCombatMode(false);
    setSelectedEnemy(null);
  }, [endCombat]);

  // Validate and execute combat action
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

      // Create action for validation
      const action = {
        participantId,
        targetParticipantId: targetId,
        actionType,
        description: `${participant.name} attempts to ${actionType}`,
        ...additionalData,
      };

      // Validate action with AI rules interpreter
      try {
        const validation = await validateCombatAction(action, participant as any);
        setActionValidation(validation);

        if (!validation.isValid) {
          // Show validation errors to user
          logger.warn('Invalid combat action:', validation.errors);
          return;
        }

        // Execute valid action
        await takeAction(action);
        setActionValidation(null);
      } catch (error) {
        logger.error('Error validating combat action:', error);
        // Proceed with action if validation fails
        await takeAction(action);
      }
    },
    [activeEncounter, takeAction, validateCombatAction],
  );

  // Handle enemy attack with AI integration
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
          damageRolls: attack.damageRoll
            ? [
                {
                  total: 0, // Will be calculated
                  rolls: [],
                  modifier: 0,
                },
              ]
            : [],
          damageType: attack.damageType,
          description: `${enemy.name} uses ${attack.name}`,
        },
      );

      // Auto-advance turn after enemy action
      setTimeout(() => {
        nextTurn();
      }, 1500);
    },
    [selectedEnemy, activeEncounter, handleCombatAction, nextTurn],
  );

  // Add a new enemy
  const addEnemy = useCallback(() => {
    // For now, add a generic goblin as example
    const newEnemy = {
      id: `enemy-${Date.now()}`,
      participantType: 'monster' as any,
      name: 'Goblin',
      characterId: null,
      initiative: 0,
      armorClass: 15,
      maxHitPoints: 7,
      currentHitPoints: 7,
      temporaryHitPoints: 0,
      position: { x: 0, y: 0 },
      conditions: [],
      deathSaves: { successes: 0, failures: 0 },
      actionTaken: false,
      bonusActionTaken: false,
      reactionTaken: false,
      movementUsed: 0,
      monsterData: {
        type: 'goblinoid',
        challengeRating: '1/4',
        alignment: 'lawful evil',
        specialAbilities: ['Nimble Escape'],
        attacks: [
          {
            name: 'Scimitar',
            attackBonus: 4,
            damageRoll: '1d6+2',
            damageType: 'slashing',
          },
          {
            name: 'Shortbow',
            attackBonus: 4,
            damageRoll: '1d6+2',
            damageType: 'piercing',
          },
        ],
      },
      spellSlots: undefined,
      activeConcentration: null,
      abilityScores: {},
      isUnconscious: false,
      isDead: false,
      isStable: false,
      visionTypes: ['normal'],
      fightingStyles: [],
      racialTraits: [],
      classFeatures: [],
      resources: {},
      characterClass: '',
      isRaging: false,
      cover: { type: 'none' },
    } as any;

    addParticipant(newEnemy);
  }, [addParticipant]);

  // Handle reaction opportunities
  const handleReactionOpportunity = useCallback(
    async (opportunity: ReactionOpportunity, selectedReaction: ActionType) => {
      if (!activeEncounter) return;

      try {
        const reactionAction = processReactionResponse(
          opportunity,
          selectedReaction,
          activeEncounter as any,
        );
        await takeAction(reactionAction);

        // Mark participant as having used their reaction
        const participant = activeEncounter.participants.find(
          (p) => p.id === opportunity.participantId,
        );
        if (participant) {
          updateParticipant(opportunity.participantId, { reactionTaken: true });
        }

        // Remove the opportunity after use
        setReactionOpportunities((prev) => prev.filter((opp) => opp.id !== opportunity.id));
      } catch (error) {
        logger.error('Error processing reaction:', error);
      }
    },
    [activeEncounter, takeAction, updateParticipant],
  );

  // Handle applying direct damage
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

      const action = {
        participantId,
        actionType: 'damage_dealt' as ActionType,
        description: `${participant.name} takes ${damageAmount} ${damageType} damage.`,
        damageDealt: damageAmount,
        damageType: damageType as any,
        effects: {
          newHitPoints: newHP,
          unconscious: isUnconscious,
          concentrationLost,
        },
      };
      await takeAction(action);
    },
    [activeEncounter, updateParticipant, takeAction],
  );

  // Handle healing
  const handleHealing = useCallback(
    async (participantId: string, healingAmount: number) => {
      if (!activeEncounter) return;

      const participant = activeEncounter.participants.find((p) => p.id === participantId);
      if (!participant) return;

      // Simple healing logic
      const maxHP = participant.maxHitPoints || 1;
      const newHP = Math.min(maxHP, (participant.currentHitPoints || 0) + healingAmount);
      const wasUnconscious = (participant.currentHitPoints || 0) <= 0;
      const revived = wasUnconscious && newHP > 0;

      // Update participant
      updateParticipant(participantId, {
        currentHitPoints: newHP,
        isUnconscious: (newHP <= 0) as any,
      } as any);

      const description = `${participant.name} heals ${healingAmount} hit points${revived ? ' and regains consciousness' : ''}`;

      const action = {
        participantId,
        actionType: 'heal' as ActionType,
        description,
        healingAmount,
        effects: {
          revivedFromUnconscious: revived,
          newHitPoints: newHP,
        },
      };

      await takeAction(action);
    },
    [activeEncounter, updateParticipant, takeAction],
  );

  const {
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
  } = useCombatMechanics({
    activeEncounter,
    handleCombatAction,
    takeAction,
    updateParticipant,
    selectedEnemy,
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
    isStartingCombat,
    actionValidation,
    reactionOpportunities,
    setReactionOpportunities,
    localShowInitiativeTracker,
    setLocalShowInitiativeTracker,
    handleStartCombat,
    handleEndCombat,
    handleCombatAction,
    handleEnemyAttack,
    addEnemy,
    handleEnhancedAttack,
    handleRacialTraitUse,
    handleClassFeature,
    handleReactionOpportunity,
    handleDeathSave,
    handleConcentrationSave,
    handleTwoWeaponAttack,
    handleApplyDamage,
    handleHealing,
    nextTurn,
    rollInitiative,
    showAdvantageModal,
    setShowAdvantageModal,
    pendingAttack,
    setPendingAttack,
  };
};
