/**
 * Character Context
 *
 * This file defines the CharacterContext for managing global character data
 * within the application. It includes the context provider, a reducer for state
 * updates (e.g., during character creation or when loading a character), and
 * a custom hook for accessing the character state and dispatch function.
 *
 * Main Components:
 * - CharacterContext: The React context object.
 * - CharacterProvider: The provider component.
 * - useCharacter: Custom hook to consume the context.
 *
 * Key State:
 * - character: Object containing details of the currently active/selected character.
 * - isDirty, currentStep, isLoading, error: UI state related to character management.
 *
 * Dependencies:
 * - React
 * - Supabase client (`@/integrations/supabase/client`) - (Note: supabase client is imported but not directly used in this file's current code, might be for future use or removed if unused)
 * - Character types (`@/types/character`)
 * - useToast hook (`@/components/ui/use-toast`)
 *
 * @author AI Dungeon Master Team
 */

// SDK Imports
import React, { createContext, useContext, useReducer, useMemo } from 'react';

import type { ReactNode } from 'react';

// Project Modules & Hooks
import { useToast } from '@/components/ui/use-toast';
import {
  characterReducer,
  initialState,
  type CharacterState,
  type CharacterAction,
} from './character/character-reducer';

/**
 * Create context with type definition for better TypeScript support
 */
const CharacterContext = createContext<{
  state: CharacterState;
  dispatch: React.Dispatch<CharacterAction>;
} | null>(null);

/**
 * Provider component that wraps the application to provide character state
 * Initializes the reducer and provides context values to children
 */
export function CharacterProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(characterReducer, initialState);
  const { toast } = useToast();

  // ⚡ Bolt: Stabilize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(
    () => ({
      state,
      dispatch,
    }),
    [state, dispatch],
  );

  return <CharacterContext.Provider value={value}>{children}</CharacterContext.Provider>;
}

/**
 * Custom hook to access character context
 * Throws an error if used outside of CharacterProvider
 */
export function useCharacter() {
  const context = useContext(CharacterContext);
  if (!context) {
    throw new Error('useCharacter must be used within a CharacterProvider');
  }
  return context;
}

// Remove the saveCharacterDraft function as it's now handled by useCharacterSave hook
