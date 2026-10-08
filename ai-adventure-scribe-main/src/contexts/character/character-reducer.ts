import { handleUpdateCharacter } from './character-updater';

import type { CharacterState, CharacterAction } from './types';

import logger from '@/lib/logger';

export type { CharacterState, CharacterAction };

/**
 * Initial state with default values to avoid null checks
 * Provides a base character object with empty/default values
 */
export const initialState: CharacterState = {
  character: {
    user_id: '', // Will be set when user authenticates
    name: '',
    race: null,
    subrace: null,
    class: null,
    level: 1,
    background: null,
    abilityScores: {
      strength: { score: 10, modifier: 0, savingThrow: false },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    },
    experience: 0,
    alignment: '',
    personalityTraits: [],
    ideals: [],
    bonds: [],
    flaws: [],
    // Inspiration system
    inspiration: false,
    personalityNotes: '',
    personalityIntegration: {
      activeTraits: [],
      inspirationTriggers: [],
      inspirationHistory: [],
    },
    equipment: [],
    skillProficiencies: [],
    toolProficiencies: [],
    savingThrowProficiencies: [],
    languages: [],
    // Spell arrays for spellcasting classes
    cantrips: [],
    knownSpells: [],
    preparedSpells: [],
    ritualSpells: [],
  },
  isDirty: false,
  currentStep: 0,
  isLoading: false,
  error: null,
};

/**
 * Reducer function to handle all character state updates
 * Each action type corresponds to a specific state transformation
 */
export function characterReducer(state: CharacterState, action: CharacterAction): CharacterState {
  // Enhanced error boundary for reducer operations
  try {
    // Debug logging to track state changes
    logger.debug('Reducer action:', action.type, 'payload' in action ? action.payload : 'No payload');
    logger.debug('Current state:', state);
    switch (action.type) {
      case 'SET_CHARACTER': {
        // Validate character data before setting
        if (!action.payload || typeof action.payload !== 'object') {
          logger.error('Invalid character payload:', action.payload);
          return {
            ...state,
            error: 'Invalid character data provided',
          };
        }

        return {
          ...state,
          character: action.payload,
          isDirty: false,
          error: null, // Clear any previous errors
        };
      }

      case 'UPDATE_CHARACTER':
        return handleUpdateCharacter(state, action.payload);

      case 'SET_GENDER':
        return {
          ...state,
          character: { ...state.character!, gender: action.payload },
          isDirty: true,
        };
      case 'SET_AGE':
        return {
          ...state,
          character: { ...state.character!, age: action.payload },
          isDirty: true,
        };
      case 'SET_HEIGHT':
        return {
          ...state,
          character: { ...state.character!, height: action.payload },
          isDirty: true,
        };
      case 'SET_WEIGHT':
        return {
          ...state,
          character: { ...state.character!, weight: action.payload },
          isDirty: true,
        };
      case 'SET_EYES':
        return {
          ...state,
          character: { ...state.character!, eyes: action.payload },
          isDirty: true,
        };
      case 'SET_SKIN':
        return {
          ...state,
          character: { ...state.character!, skin: action.payload },
          isDirty: true,
        };
      case 'SET_HAIR':
        return {
          ...state,
          character: { ...state.character!, hair: action.payload },
          isDirty: true,
        };
      default: {
        logger.warn('Unknown action type dispatched:', action);
        return state;
      }
    }
  } catch (error) {
    logger.error('Unexpected error in character reducer:', error);
    return {
      ...state,
      error: 'An unexpected error occurred while updating character data',
    };
  }
}
