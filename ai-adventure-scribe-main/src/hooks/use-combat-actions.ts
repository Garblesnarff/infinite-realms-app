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
import { useCombatAIIntegration } from '@/hooks/use-combat-ai-integration';
import { useCombatMechanics } from '@/hooks/use-combat-mechanics';
import { useGameSession } from '@/hooks/use-game-session';

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
        position: p.position || { x: 0, y: 0, sceneId: '' },
        conditions: p.conditions || [],
        deathSaves: p.deathSaves || { successes: 0, failures: 0, isStable: false },
        actionTaken: false,
        bonusActionTaken: false,
        reactionTaken: false,
        movementUsed: 0,
        monsterData: p.monsterData,
        spellSlots: p.spellSlots,
        activeConcentration: p.activeConcentration,
        // CombatParticipant doesn't carry abilityScores - see bead ai-dungeon-master-d20.
        abilityScores: {},
        isUnconscious: false,
        isDead: false,
        isStable: false,
        visionTypes: p.visionTypes || ['normal'],
        fightingStyles: p.fightingStyles || [],
        racialTraits: p.racialTraits || [],
        classFeatures: p.classFeatures || [],
        resources: p.resources || {},
        characterClass: p.characterClass || '',
        isRaging: false,
        cover: p.cover || { type: 'none', acBonus: 0, dexSaveBonus: 0, canBeTargeted: true },
      })) as unknown as CombatParticipant[];

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

  // Extract handlers to modular hook
  const {
    actionValidation,
    reactionOpportunities,
    setReactionOpportunities,
    handleCombatAction,
    handleEnemyAttack,
    handleReactionOpportunity,
    handleApplyDamage,
    handleHealing,
  } = useCombatActionHandlers({
    activeEncounter: activeEncounter || null,
    takeAction,
    updateParticipant,
    nextTurn,
    validateCombatAction,
    selectedEnemy,
  });

  // Add a new enemy
  const addEnemy = useCallback(() => {
    // For now, add a generic goblin as example
    const newEnemy: Partial<CombatParticipant> = {
      id: `enemy-${Date.now()}`,
      participantType: 'monster',
      name: 'Goblin',
      characterId: undefined,
      initiative: 0,
      armorClass: 15,
      maxHitPoints: 7,
      currentHitPoints: 7,
      temporaryHitPoints: 0,
      position: { x: 0, y: 0, sceneId: '' },
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
            reach: 5,
            description: 'Melee Weapon Attack',
          },
          {
            name: 'Shortbow',
            attackBonus: 4,
            damageRoll: '1d6+2',
            damageType: 'piercing',
            reach: 80,
            description: 'Ranged Weapon Attack',
          },
        ],
      },
      spellSlots: undefined,
      activeConcentration: null,
      isUnconscious: false,
      isDead: false,
      isStable: false,
      visionTypes: [{ type: 'normal', range: 60 }],
      fightingStyles: [],
      racialTraits: [],
      resources: {},
      characterClass: '',
      isRaging: false,
      cover: { type: 'none', acBonus: 0, dexSaveBonus: 0, canBeTargeted: true },
    };

    addParticipant(newEnemy);
  }, [addParticipant]);

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
    setReactionOpportunities: setReactionOpportunities as React.Dispatch<
      React.SetStateAction<ReactionOpportunity[]>
    >,
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
