import type { Character } from '@/types/character';

/**
 * Interface defining the shape of the character state
 * Includes the character data, UI state, and error handling
 */
export interface CharacterState {
  character: Character | null;
  isDirty: boolean;
  currentStep: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Union type defining all possible actions that can be dispatched to modify character state
 * Each action type has its own payload structure
 */
export type CharacterAction =
  | { type: 'SET_CHARACTER'; payload: Character }
  | { type: 'UPDATE_CHARACTER'; payload: Partial<Character> }
  /**
   * #1670: the engine's remaining uses for a limited-feature pool, from an intent result. Not a user
   * edit: it does not mark the character dirty, so the next sheet save cannot write it back stale.
   */
  | {
      type: 'SET_TRACKED_USES';
      payload: { feature: string; currentUses: number; maxUses?: number };
    }
  | { type: 'SET_GENDER'; payload: 'male' | 'female' }
  | { type: 'SET_AGE'; payload: number }
  | { type: 'SET_HEIGHT'; payload: number }
  | { type: 'SET_WEIGHT'; payload: number }
  | { type: 'SET_EYES'; payload: string | undefined }
  | { type: 'SET_SKIN'; payload: string | undefined }
  | { type: 'SET_HAIR'; payload: string | undefined };
