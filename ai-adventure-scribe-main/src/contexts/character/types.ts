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
  /**
   * #210 QA-026: whether completing the character generates a background
   * image. A creation-time choice, not stored data — it rides the wizard
   * state (not the Character row, whose shape open PR #1744 owns) and
   * defaults to true, preserving the current always-generate behavior.
   * It is persisted by the wizard draft (WizardDraft.generateBackgroundImage,
   * v2), so a resumed draft keeps the user's opt-out.
   */
  generateBackgroundImage: boolean;
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
  | { type: 'SET_HAIR'; payload: string | undefined }
  | { type: 'SET_GENERATE_BACKGROUND_IMAGE'; payload: boolean };
