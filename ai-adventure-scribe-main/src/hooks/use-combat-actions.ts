/**
 * useCombatActions Hook
 *
 * Encapsulates combat logic and action handlers for the CombatInterface.
 * Manages combat state transitions and validates actions using AI integration.
 */

import { useState } from 'react';
import type { ActionType, ReactionOpportunity, CombatParticipant } from '@/types/combat';
import { useCombat } from '@/contexts/CombatContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombatAIIntegration } from '@/hooks/use-combat-ai-integration';
import { useGameSession } from '@/hooks/use-game-session';
import logger from '@/lib/logger';
import { rollDice, rollAttack } from '@/utils/diceUtils';
import { calculateAttackDamage } from '@/utils/attackUtils';
import { getRageDamageBonus, canUseClassFeature } from '@/utils/classFeatures';
import { needsDeathSaves, rollDeathSave } from '@/utils/combat/deathSaves';
import { canUseRacialTrait } from '@/utils/racialTraits';
import { processReactionResponse } from '@/utils/reactionSystem';
import { checkConcentration } from '@/utils/spell-management';
import {
  canUseTwoWeaponFighting,
  makeMainHandAttack,
  canMakeOffHandAttack,
  makeOffHandAttack,
} from '@/utils/twoWeaponFighting';
import {
  createDefaultLightWeapons,
  equipMainHandWeapon,
  equipOffHandWeapon,
} from '@/utils/equipmentUtils';

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
  const [showAdvantageModal, setShowAdvantageModal] = useState(false);
  const [pendingAttack, setPendingAttack] = useState<{
    participantId: string;
    targetId?: string;
    actionType: ActionType;
    hasAdvantage?: boolean;
    hasDisadvantage?: boolean;
  } | null>(null);

  // Get player characters and potential enemies
  const playerParticipants =
    activeEncounter?.participants.filter((p) => p.participantType === 'player') || [];
  const enemyParticipants =
    activeEncounter?.participants.filter((p) => p.participantType === 'monster') || [];
  const playerCharacterId = characterState.character?.id;
  const isPlayersTurn = Boolean(
    activeEncounter?.currentTurnParticipantId &&
      activeEncounter.participants.find((p) => p.id === activeEncounter.currentTurnParticipantId)
        ?.characterId === playerCharacterId,
  );

  // Handle starting combat
  const handleStartCombat = async () => {
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
  };

  // Handle ending combat
  const handleEndCombat = async () => {
    await endCombat();
    setShowCombatMode(false);
    setSelectedEnemy(null);
  };

  // Validate and execute combat action
  const handleCombatAction = async (
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
  };

  // Handle enemy attack with AI integration
  const handleEnemyAttack = async (attack: any) => {
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
  };

  // Add a new enemy
  const addEnemy = () => {
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
  };

  // Handle enhanced attack with optional Divine Smite
  const handleEnhancedAttack = async (
    participantId: string,
    targetId?: string,
    actionType: ActionType = 'attack',
    hasAdvantage: boolean = false,
    hasDisadvantage: boolean = false,
    divineSmiteSlotLevel?: number, // For Paladin's Divine Smite
  ) => {
    if (!activeEncounter) return;

    const participant = activeEncounter.participants.find((p) => p.id === participantId);
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
      { name: 'Longsword', damage: '1d8+3', damageType: 'slashing', properties: {} },
      participant as any,
      false,
      isCritical,
      undefined,
      activeEncounter as any,
      divineSmiteSlotLevel,
    );

    let damageRolls = [damageResult.baseDamageRoll];
    let totalDamage = damageResult.baseDamageRoll.reduce((sum, roll) => sum + (roll.total || 0), 0);

    // Add sneak attack damage if applicable
    if (damageResult.sneakAttackRoll) {
      damageRolls = [...damageRolls, ...damageResult.sneakAttackRoll];
      totalDamage += damageResult.sneakAttackRoll.reduce((sum, roll) => sum + (roll.total || 0), 0);
    }

    // Add divine smite damage if applicable
    if (damageResult.divineSmiteRoll) {
      damageRolls = [...damageRolls, ...damageResult.divineSmiteRoll];
      totalDamage += damageResult.divineSmiteRoll.reduce((sum, roll) => sum + (roll.total || 0), 0);
    }

    // Add Rage damage for Barbarian
    if (participant.isRaging && participant.characterClass === 'barbarian') {
      const rageDamage = getRageDamageBonus(participant.level || 1);
      totalDamage += rageDamage;
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
  };

  // Handle racial trait usage
  const handleRacialTraitUse = async (participantId: string, traitName: string) => {
    if (!activeEncounter) return;

    const participant = activeEncounter.participants.find((p) => p.id === participantId);
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
  };

  // Handle class features
  const handleClassFeature = async (participantId: string, featureName: string) => {
    if (!activeEncounter) return;

    const participant = activeEncounter.participants.find((p) => p.id === participantId);
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
  };

  // Handle reaction opportunities
  const handleReactionOpportunity = async (
    opportunity: ReactionOpportunity,
    selectedReaction: ActionType,
  ) => {
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
  };

  // Handle death saving throw
  const handleDeathSave = async (participantId: string) => {
    if (!activeEncounter) return;

    const participant = activeEncounter.participants.find((p) => p.id === participantId);
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
  };

  // Handle concentration save
  const handleConcentrationSave = async (participantId: string, dc: number) => {
    if (!activeEncounter) return;

    const participant = activeEncounter.participants.find((p) => p.id === participantId);
    if (!participant || !(participant as any).activeConcentration) return;

    // Inline concentration save logic
    const conMod = (participant as any).abilityScores?.constitution?.modifier || 0;
    const proficiencyBonus = Math.floor((participant.level || 1) / 4) + 2;
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
  };

  // Handle two-weapon fighting attacks
  const handleTwoWeaponAttack = async (participantId: string, targetId?: string) => {
    if (!activeEncounter) return;

    const participant = activeEncounter.participants.find((p) => p.id === participantId);
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
  };

  // Handle applying direct damage
  const handleApplyDamage = async (
    participantId: string,
    damageAmount: number,
    damageType: string,
  ) => {
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
  };

  // Handle healing
  const handleHealing = async (participantId: string, healingAmount: number) => {
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
  };

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
