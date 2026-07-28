/**
 * Combat Context Provider
 *
 * Manages D&D 5e combat state in a tabletop-focused way.
 * Handles initiative order, turn management, HP tracking, and conditions
 * as they would be managed at a physical D&D table.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from 'react';

import { useCharacter } from './CharacterContext';
import { combatReducer, initialCombatState } from './combat/combat-reducer';
import { createHealthHandlers } from './combat/health-handlers';
import {
  createReactionHandlers,
  createParticipantReactionHandlers,
} from './combat/reaction-handlers';
import { useAuthoritativeCombatSync } from './combat/use-authoritative-combat-sync';
import { useCombatLifecycle } from './combat/use-combat-lifecycle';
import { useParticipantManagement } from './combat/use-participant-management';
import { useTakeAction } from './combat/use-take-action';
import { createWeaponHandlers } from './combat/weapon-handlers';

import type { CombatContextValue } from '@/types/combat';

// ===========================
// Context Creation
// ===========================

const CombatContext = createContext<CombatContextValue | undefined>(undefined);

export const useCombat = (): CombatContextValue => {
  const context = useContext(CombatContext);
  if (!context) {
    throw new Error('useCombat must be used within a CombatProvider');
  }
  return context;
};

// ===========================
// Provider Component
// ===========================

interface CombatProviderProps {
  children: React.ReactNode;
  sessionId?: string;
}

export const CombatProvider: React.FC<CombatProviderProps> = ({ children, sessionId }) => {
  const [state, dispatch] = useReducer(combatReducer, initialCombatState);
  const { state: characterState } = useCharacter();

  // Ref to provide current state to extracted handlers without stale closures
  const stateRef = useRef(state);

  // Sync stateRef with state changes to prevent stale closures in extracted handlers.
  // Assigned during render as well: the authoritative sync reconciles against the encounter
  // held *now*, and an effect-only update would still be showing the previous render's.
  stateRef.current = state;
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const getActiveEncounter = useCallback(() => stateRef.current.activeEncounter, []);
  const refreshCombatState = useAuthoritativeCombatSync(sessionId, dispatch, getActiveEncounter);

  // ===========================
  // Extracted Handlers (stable references - dispatch never changes)
  // ===========================

  const {
    addReactionOpportunity,
    removeReactionOpportunity,
    clearReactionOpportunities,
    setPendingReaction,
  } = useMemo(() => createReactionHandlers(dispatch), []);

  const {
    addParticipantReactionOpportunity,
    removeParticipantReactionOpportunity,
    clearParticipantReactionOpportunities,
  } = useMemo(() => createParticipantReactionHandlers(dispatch, () => stateRef.current), []);

  const { equipMainHandWeapon, equipOffHandWeapon, unequipMainHandWeapon, unequipOffHandWeapon } =
    useMemo(() => createWeaponHandlers(dispatch), []);

  const { dealDamage, healDamage, applyCondition, removeCondition, rollDeathSave } = useMemo(
    () => createHealthHandlers(dispatch, () => stateRef.current),
    [],
  );

  // ===========================
  // Extracted Callback Hooks
  // ===========================

  const { startCombat, endCombat, nextTurn, rollInitiative } = useCombatLifecycle({
    state,
    dispatch,
    character: characterState.character,
  });

  const takeAction = useTakeAction({
    state,
    dispatch,
    dealDamage,
    addReactionOpportunity,
    addParticipantReactionOpportunity,
  });

  const { addParticipant, removeParticipant, updateParticipant, moveParticipant } =
    useParticipantManagement({
      state,
      dispatch,
      character: characterState.character,
      addReactionOpportunity,
      addParticipantReactionOpportunity,
    });

  // ===========================
  // Context Value
  // ===========================

  // Stabilize context value to prevent unnecessary re-renders of consumers.
  const contextValue: CombatContextValue = useMemo(
    () => ({
      state,
      startCombat,
      endCombat,
      refreshCombatState,
      nextTurn,
      rollInitiative,
      takeAction,
      dealDamage,
      healDamage,
      applyCondition,
      removeCondition,
      rollDeathSave,
      addParticipant,
      removeParticipant,
      updateParticipant,
      // Reaction management
      addReactionOpportunity,
      removeReactionOpportunity,
      clearReactionOpportunities,
      setPendingReaction,
      // Participant reaction opportunities
      addParticipantReactionOpportunity,
      removeParticipantReactionOpportunity,
      clearParticipantReactionOpportunities,
      // Movement actions
      moveParticipant,
      // Weapon management
      equipMainHandWeapon,
      equipOffHandWeapon,
      unequipMainHandWeapon,
      unequipOffHandWeapon,
    }),
    [
      state,
      startCombat,
      endCombat,
      refreshCombatState,
      nextTurn,
      rollInitiative,
      takeAction,
      dealDamage,
      healDamage,
      applyCondition,
      removeCondition,
      rollDeathSave,
      addParticipant,
      removeParticipant,
      updateParticipant,
      addReactionOpportunity,
      removeReactionOpportunity,
      clearReactionOpportunities,
      setPendingReaction,
      addParticipantReactionOpportunity,
      removeParticipantReactionOpportunity,
      clearParticipantReactionOpportunities,
      moveParticipant,
      equipMainHandWeapon,
      equipOffHandWeapon,
      unequipMainHandWeapon,
      unequipOffHandWeapon,
    ],
  );

  return <CombatContext.Provider value={contextValue}>{children}</CombatContext.Provider>;
};
