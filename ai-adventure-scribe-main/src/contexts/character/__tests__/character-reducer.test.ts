/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { characterReducer, initialState } from '../character-reducer';

import type { CharacterState } from '../character-reducer';
import type { Character } from '@/types/character';

import logger from '@/lib/logger';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('characterReducer', () => {
  const mockCharacter: Character = {
    user_id: 'user-123',
    name: 'Test Character',
    race: 'Human',
    subrace: null,
    class: 'Fighter',
    level: 1,
    abilityScores: {
      strength: { score: 10, modifier: 0, savingThrow: false },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    },
    experience: 0,
    alignment: 'Neutral',
    personalityTraits: [],
    ideals: [],
    bonds: [],
    flaws: [],
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
    cantrips: [],
    knownSpells: [],
    preparedSpells: [],
    ritualSpells: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle SET_CHARACTER', () => {
    const action = { type: 'SET_CHARACTER' as const, payload: mockCharacter };
    const state = characterReducer(initialState, action);

    expect(state.character).toEqual(mockCharacter);
    expect(state.isDirty).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should return error on invalid SET_CHARACTER payload', () => {
    const action = { type: 'SET_CHARACTER' as const, payload: null as any };
    const state = characterReducer(initialState, action);

    expect(state.error).toBe('Invalid character data provided');
  });

  it('should handle UPDATE_CHARACTER', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const action = { type: 'UPDATE_CHARACTER' as const, payload: { name: 'Updated Name' } };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.character?.name).toBe('Updated Name');
    expect(state.isDirty).toBe(true);
    expect(state.error).toBeNull();
  });

  it('should not set isDirty if UPDATE_CHARACTER has no changes', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter, isDirty: false };
    const action = { type: 'UPDATE_CHARACTER' as const, payload: { name: mockCharacter.name } };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.isDirty).toBe(false);
  });

  it('should return error if UPDATE_CHARACTER is called with no character in state', () => {
    const stateWithoutCharacter = { ...initialState, character: null };
    const action = { type: 'UPDATE_CHARACTER' as const, payload: { name: 'New Name' } };
    const state = characterReducer(stateWithoutCharacter, action);

    expect(state.error).toBe('No character data to update');
  });

  it('should handle SET_GENDER, SET_AGE, SET_HEIGHT, SET_WEIGHT, SET_EYES, SET_SKIN, SET_HAIR', () => {
    let state = { ...initialState, character: mockCharacter };

    state = characterReducer(state, { type: 'SET_GENDER', payload: 'female' });
    expect(state.character?.gender).toBe('female');

    state = characterReducer(state, { type: 'SET_GENDER', payload: 'male' });
    expect(state.character?.gender).toBe('male');

    state = characterReducer(state, { type: 'SET_AGE', payload: 25 });
    expect(state.character?.age).toBe(25);

    state = characterReducer(state, { type: 'SET_HEIGHT', payload: 170 });
    expect(state.character?.height).toBe(170);

    state = characterReducer(state, { type: 'SET_WEIGHT', payload: 65 });
    expect(state.character?.weight).toBe(65);

    state = characterReducer(state, { type: 'SET_EYES', payload: 'Blue' });
    expect(state.character?.eyes).toBe('Blue');

    state = characterReducer(state, { type: 'SET_SKIN', payload: 'Pale' });
    expect(state.character?.skin).toBe('Pale');

    state = characterReducer(state, { type: 'SET_HAIR', payload: 'Blonde' });
    expect(state.character?.hair).toBe('Blonde');

    expect(state.isDirty).toBe(true);
  });

  it('should handle SET_STEP', () => {
    const action = { type: 'SET_STEP' as const, payload: 5 };
    const state = characterReducer(initialState, action);

    expect(state.currentStep).toBe(5);
    expect(state.error).toBeNull();
  });

  it('should return error on invalid SET_STEP', () => {
    const action = { type: 'SET_STEP' as const, payload: 25 };
    const state = characterReducer(initialState, action);

    expect(state.error).toBe('Invalid character creation step');
  });

  it('should handle SET_LOADING', () => {
    const action = { type: 'SET_LOADING' as const, payload: true };
    const state = characterReducer(initialState, action);

    expect(state.isLoading).toBe(true);
  });

  it('should return error on invalid SET_LOADING payload', () => {
    const action = { type: 'SET_LOADING' as const, payload: 123 as any };
    const state = characterReducer(initialState, action);

    expect(state.error).toBe('Invalid loading state');
  });

  it('should handle SET_ERROR', () => {
    const action = { type: 'SET_ERROR' as const, payload: 'Test Error' };
    const state = characterReducer(initialState, action);

    expect(state.error).toBe('Test Error');
  });

  it('should return error on invalid SET_ERROR payload', () => {
    const action = { type: 'SET_ERROR' as const, payload: 123 as any };
    const state = characterReducer(initialState, action);

    expect(state.error).toBe('Invalid error message format');
  });

  it('should handle UPDATE_SPELL_SLOTS', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const spellSlots = {
      1: { max: 4, current: 2 },
      2: { max: 2, current: 2 },
    };
    const action = { type: 'UPDATE_SPELL_SLOTS' as const, payload: spellSlots };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.character?.spellSlots).toEqual(spellSlots);
    expect(state.isDirty).toBe(true);
  });

  it('should return error on invalid UPDATE_SPELL_SLOTS payload', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const action = {
      type: 'UPDATE_SPELL_SLOTS' as const,
      payload: { 1: { max: -1, current: 0 } } as any,
    };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.error).toBe('Invalid spell slot structure');
  });

  it('should return error on invalid UPDATE_SPELL_SLOTS payload (not an object)', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const action = { type: 'UPDATE_SPELL_SLOTS' as const, payload: 123 as any };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.error).toBe('Invalid spell slot data');
  });

  it('should return error on invalid spell slot level in UPDATE_SPELL_SLOTS', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const action = {
      type: 'UPDATE_SPELL_SLOTS' as const,
      payload: { invalid: { max: 4, current: 4 } } as any,
    };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.error).toBe('Invalid spell slot level');
  });

  it.each(['1slot', '1.5', '10', '9007199254740992'])(
    'should reject the malformed spell slot level %j',
    (level) => {
      const action = {
        type: 'UPDATE_SPELL_SLOTS' as const,
        payload: { [level]: { max: 4, current: 4 } } as any,
      };

      const state = characterReducer(initialState, action);

      expect(state.error).toBe('Invalid spell slot level');
    },
  );

  it('should handle UPDATE_CONCENTRATION', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const action = { type: 'UPDATE_CONCENTRATION' as const, payload: 'Haste' };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.character?.activeConcentration).toBe('Haste');
    expect(state.isDirty).toBe(true);
  });

  it('should return error on invalid UPDATE_CONCENTRATION payload', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const action = { type: 'UPDATE_CONCENTRATION' as const, payload: 123 as any };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.error).toBe('Invalid concentration spell data');
  });

  it('should return error if UPDATE_CONCENTRATION is called with no character in state', () => {
    const stateWithoutCharacter = { ...initialState, character: null };
    const action = { type: 'UPDATE_CONCENTRATION' as const, payload: 'Haste' };
    const state = characterReducer(stateWithoutCharacter, action);

    expect(state.error).toBe('No character data to update');
  });

  it('should return error if UPDATE_CHARACTER is called with invalid payload', () => {
    const stateWithCharacter = { ...initialState, character: mockCharacter };
    const action = { type: 'UPDATE_CHARACTER' as const, payload: null as any };
    const state = characterReducer(stateWithCharacter, action);

    expect(state.error).toBe('Invalid character update data');
  });

  it('should log spell updates during UPDATE_CHARACTER', () => {
    const stateWithCharacter = {
      ...initialState,
      character: { ...mockCharacter, knownSpells: undefined } as any,
    };
    const action = {
      type: 'UPDATE_CHARACTER' as const,
      payload: { knownSpells: [{ id: 'spell-1', name: 'Magic Missile' }] as any },
    };
    characterReducer(stateWithCharacter, action);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Spell update detected'),
      expect.anything(),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('Final spell state after update'),
      expect.anything(),
    );
  });

  it('should handle RESET', () => {
    const dirtyState: CharacterState = {
      ...initialState,
      character: mockCharacter,
      isDirty: true,
      currentStep: 5,
    };
    const action = { type: 'RESET' as const };
    const state = characterReducer(dirtyState, action);

    expect(state).toEqual(initialState);
  });

  it('should return current state for unknown action type', () => {
    const action = { type: 'UNKNOWN' as any };
    const state = characterReducer(initialState, action);

    expect(state).toEqual(initialState);
  });

  it('should catch unexpected errors and return error state', () => {
    // Mock logger.debug to throw an error when called in the reducer
    (logger.debug as any).mockImplementationOnce(() => {
      throw new Error('Crashed');
    });

    const action = { type: 'SET_CHARACTER' as const, payload: mockCharacter };
    const state = characterReducer(initialState, action);

    expect(state.error).toBe('An unexpected error occurred while updating character data');
  });

  it('should return error if UPDATE_SPELL_SLOTS is called with no character in state', () => {
    const stateWithoutCharacter = { ...initialState, character: null };
    const action = { type: 'UPDATE_SPELL_SLOTS' as const, payload: { 1: { max: 4, current: 4 } } };
    const state = characterReducer(stateWithoutCharacter, action);

    expect(state.error).toBe('No character data to update');
  });
});
