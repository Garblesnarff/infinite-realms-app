/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useSpellSelectionValidation } from '../useSpellSelectionValidation';

import type { Character, Spell } from '@/types/character';

const mockValidateSpellSelection = vi.fn();
const mockValidateSpellSelectionAsync = vi.fn();

vi.mock('@/utils/spell-validation', () => ({
  validateSpellSelection: (...args: any[]) => mockValidateSpellSelection(...args),
  validateSpellSelectionAsync: (...args: any[]) => mockValidateSpellSelectionAsync(...args),
}));

const mockLoggerError = vi.fn();

vi.mock('@/lib/logger', () => ({
  default: {
    error: (...args: any[]) => mockLoggerError(...args),
  },
}));

describe('useSpellSelectionValidation', () => {
  const mockCharacter: Character = {
    id: 'char-1',
    name: 'Test Wizard',
    level: 1,
    class: {
      id: 'wizard',
      name: 'Wizard',
      description: 'A master of magic',
      hitDie: 6,
      primaryAbility: 'intelligence',
      savingThrowProficiencies: ['intelligence', 'wisdom'],
      skillChoices: [],
      numSkillChoices: 0,
      classFeatures: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    },
    race: {
      id: 'human',
      name: 'Human',
      description: 'Versatile',
      abilityScoreIncrease: {},
      speed: 30,
      traits: [],
      languages: ['Common'],
    },
    abilityScores: {
      strength: { score: 10, modifier: 0, savingThrow: false },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    },
  };

  const mockAvailableCantrips: Spell[] = [
    { id: 'cantrip-1', name: 'Cantrip 1', level: 0, school: 'Evocation', description: 'desc' },
  ];
  const mockAvailableSpells: Spell[] = [
    { id: 'spell-1', name: 'Spell 1', level: 1, school: 'Evocation', description: 'desc' },
  ];

  const stableSelectedCantrips = ['cantrip-1'];
  const stableSelectedSpells = ['spell-1'];
  const emptyArray: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return initial state and invalid validation when character is null', () => {
    const { result } = renderHook(() =>
      useSpellSelectionValidation({
        character: null,
        selectedCantrips: emptyArray,
        selectedSpells: emptyArray,
        availableCantrips: emptyArray,
        availableSpells: emptyArray,
      }),
    );

    expect(result.current.validation).toEqual({
      valid: false,
      errors: [],
      warnings: [],
    });
    expect(result.current.isValidating).toBe(false);
    expect(result.current.canProceed).toBe(false);
    expect(mockValidateSpellSelectionAsync).not.toHaveBeenCalled();
  });

  it('should run async validation and update state upon success', async () => {
    const expectedResult = {
      valid: true,
      errors: [],
      warnings: ['A nice warning'],
    };
    mockValidateSpellSelectionAsync.mockResolvedValueOnce(expectedResult);

    const { result } = renderHook(() =>
      useSpellSelectionValidation({
        character: mockCharacter,
        selectedCantrips: stableSelectedCantrips,
        selectedSpells: stableSelectedSpells,
        availableCantrips: mockAvailableCantrips,
        availableSpells: mockAvailableSpells,
      }),
    );

    // Should indicate it is validating initially
    expect(result.current.isValidating).toBe(true);

    // Wait for validation to resolve
    await waitFor(() => {
      expect(result.current.isValidating).toBe(false);
    });

    expect(result.current.validation).toEqual(expectedResult);
    expect(result.current.canProceed).toBe(true);
    expect(mockValidateSpellSelectionAsync).toHaveBeenCalledWith(
      mockCharacter,
      stableSelectedCantrips,
      stableSelectedSpells,
      ['cantrip-1'],
      ['spell-1'],
    );
  });

  it('should fall back to sync validation when async validation fails', async () => {
    const errorMsg = 'Async error';
    mockValidateSpellSelectionAsync.mockRejectedValueOnce(new Error(errorMsg));

    const syncResult = {
      valid: true,
      errors: [],
      warnings: ['Sync warning'],
    };
    mockValidateSpellSelection.mockReturnValueOnce(syncResult);

    const { result } = renderHook(() =>
      useSpellSelectionValidation({
        character: mockCharacter,
        selectedCantrips: stableSelectedCantrips,
        selectedSpells: stableSelectedSpells,
        availableCantrips: mockAvailableCantrips,
        availableSpells: mockAvailableSpells,
      }),
    );

    expect(result.current.isValidating).toBe(true);

    await waitFor(() => {
      expect(result.current.isValidating).toBe(false);
    });

    expect(result.current.validation).toEqual(syncResult);
    expect(result.current.canProceed).toBe(true);
    expect(mockLoggerError).toHaveBeenCalledWith('Async spell validation failed:', expect.any(Error));
    expect(mockValidateSpellSelection).toHaveBeenCalledWith(
      mockCharacter,
      stableSelectedCantrips,
      stableSelectedSpells,
      ['cantrip-1'],
      ['spell-1'],
    );
  });

  it('should not set state if the hook unmounts during async validation', async () => {
    let resolvePromise: (value: any) => void = () => {};
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    mockValidateSpellSelectionAsync.mockReturnValueOnce(promise);

    const { result, unmount } = renderHook(() =>
      useSpellSelectionValidation({
        character: mockCharacter,
        selectedCantrips: stableSelectedCantrips,
        selectedSpells: stableSelectedSpells,
        availableCantrips: mockAvailableCantrips,
        availableSpells: mockAvailableSpells,
      }),
    );

    expect(result.current.isValidating).toBe(true);

    // Unmount before resolving
    unmount();

    // Resolve the promise
    resolvePromise({
      valid: true,
      errors: [],
      warnings: [],
    });

    // Wait a brief tick to let promise chain run
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Result shouldn't have changed to finished since it unmounted
    expect(result.current.isValidating).toBe(true);
  });
});
