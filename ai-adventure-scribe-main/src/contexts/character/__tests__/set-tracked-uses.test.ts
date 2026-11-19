import { describe, it, expect } from 'vitest';

import { characterReducer, initialState } from '../character-reducer';

import type { CharacterState } from '../types';

/**
 * #1670: SET_TRACKED_USES writes the engine's pool number where the sheet panel reads class
 * features. It is not a user edit, so it must not mark the character dirty; otherwise the next sheet
 * save would write the whole character back with the stale pool.
 */
describe('SET_TRACKED_USES (#1670)', () => {
  const stateWithPool = {
    ...initialState,
    character: {
      ...initialState.character,
      classFeatures: {
        lay_on_hands: { currentUses: 15, maxUses: 15 },
        divine_sense: { currentUses: 2 },
      },
    },
    isDirty: false,
  } as unknown as CharacterState;

  it('sets the remaining uses and keeps the max and the other features', () => {
    const next = characterReducer(stateWithPool, {
      type: 'SET_TRACKED_USES',
      payload: { feature: 'lay_on_hands', currentUses: 5, maxUses: 15 },
    });
    expect(next.character?.classFeatures).toEqual({
      lay_on_hands: { currentUses: 5, maxUses: 15 },
      divine_sense: { currentUses: 2 },
    });
  });

  it('does not mark the character dirty', () => {
    const next = characterReducer(stateWithPool, {
      type: 'SET_TRACKED_USES',
      payload: { feature: 'lay_on_hands', currentUses: 5 },
    });
    expect(next.isDirty).toBe(false);
    expect(next.character?.classFeatures?.lay_on_hands).toEqual({ currentUses: 5, maxUses: 15 });
  });

  it('does nothing without a loaded character', () => {
    const empty = { ...initialState, character: null } as unknown as CharacterState;
    expect(
      characterReducer(empty, {
        type: 'SET_TRACKED_USES',
        payload: { feature: 'second_wind', currentUses: 0 },
      }),
    ).toBe(empty);
  });
});
