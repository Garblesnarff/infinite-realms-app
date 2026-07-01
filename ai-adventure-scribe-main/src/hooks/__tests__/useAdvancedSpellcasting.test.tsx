/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAdvancedSpellcasting } from '../useAdvancedSpellcasting';

import { useCharacter } from '@/contexts/CharacterContext';
import { useToast } from '@/hooks/use-toast';
import { spellApi } from '@/services/spellApi';

// Mock dependencies
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getClassSpells: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useAdvancedSpellcasting', () => {
  const mockDispatch = vi.fn();
  const mockToast = vi.fn();

  const mockSpells = [
    { id: 'spell-1', name: 'Spell 1', level: 1, ritual: false },
    { id: 'spell-2', name: 'Spell 2', level: 1, ritual: true },
    { id: 'cantrip-1', name: 'Cantrip 1', level: 0, ritual: false },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as any).mockReturnValue({ toast: mockToast });
    (spellApi.getClassSpells as any).mockResolvedValue({
      cantrips: mockSpells.filter((s) => s.level === 0),
      spells: mockSpells.filter((s) => s.level > 0),
    });
  });

  it('should initialize with default values for non-spellcasters', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: { id: 'fighter', name: 'Fighter' },
          level: 1,
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(result.current.hasSpellcasting).toBe(false);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { advancedSpellcastingComplete: true },
    });
  });

  it('should calculate limits for a Wizard (Prepared Spells)', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'wizard',
            name: 'Wizard',
            spellcasting: { ability: 'intelligence' },
          },
          level: 3,
          abilityScores: {
            intelligence: { score: 16, modifier: 3 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // Wizard at level 3 with +3 Int should have 3 + 3 = 6 prepared spells
    expect(result.current.canPrepareSpells).toBe(true);
    expect(result.current.maxPreparedSpells).toBe(6);
    expect(result.current.usesRitualCasting).toBe(true);
  });

  it('should handle spell preparation and removal for Wizard', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'wizard',
            name: 'Wizard',
            spellcasting: { ability: 'intelligence' },
          },
          level: 1,
          abilityScores: {
            intelligence: { score: 16, modifier: 3 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // Limit is 1 + 3 = 4
    act(() => {
      result.current.handleSpellPreparation('spell-1', true);
    });

    expect(result.current.preparedSpells).toContain('spell-1');

    act(() => {
      result.current.handleSpellPreparation('spell-1', false);
    });

    expect(result.current.preparedSpells).not.toContain('spell-1');
  });

  it('should calculate limits for a Sorcerer (Metamagic)', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'sorcerer',
            name: 'Sorcerer',
            spellcasting: { ability: 'charisma' },
          },
          level: 3,
          abilityScores: {
            charisma: { score: 16, modifier: 3 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(result.current.usesMetamagic).toBe(true);
    expect(result.current.sorceryPoints).toBe(3);
    expect(result.current.maxMetamagicOptions).toBe(2);
  });

  it('should handle metamagic selection and removal for Sorcerer', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'sorcerer',
            name: 'Sorcerer',
            spellcasting: { ability: 'charisma' },
          },
          level: 3,
          abilityScores: {
            charisma: { score: 16, modifier: 3 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    act(() => {
      result.current.handleMetamagicSelection('quickened-spell', true);
    });

    expect(result.current.selectedMetamagic).toContain('quickened-spell');

    act(() => {
      result.current.handleMetamagicSelection('quickened-spell', false);
    });

    expect(result.current.selectedMetamagic).not.toContain('quickened-spell');
  });

  it('should calculate limits for a Warlock (Pact Magic)', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'warlock',
            name: 'Warlock',
            spellcasting: { ability: 'charisma' },
          },
          level: 2,
          abilityScores: {
            charisma: { score: 16, modifier: 3 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(result.current.usesPactMagic).toBe(true);
    // Warlock level 2 has 2 slots, level 1 slots, 3 spells known
    expect(result.current.pactProgression?.pactSlots).toBe(2);
    expect(result.current.maxPactSpells).toBe(3);
  });

  it('should handle pact spell selection and removal for Warlock', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'warlock',
            name: 'Warlock',
            spellcasting: { ability: 'charisma' },
          },
          level: 2,
          abilityScores: {
            charisma: { score: 16, modifier: 3 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    act(() => {
      result.current.handlePactSpellSelection('spell-1', true);
    });

    expect(result.current.pactMagicSpells).toContain('spell-1');

    act(() => {
      result.current.handlePactSpellSelection('spell-1', false);
    });

    expect(result.current.pactMagicSpells).not.toContain('spell-1');
  });

  it('should handle spell fetch error', async () => {
    (spellApi.getClassSpells as any).mockRejectedValue(new Error('Fetch failed'));
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'wizard',
            name: 'Wizard',
            spellcasting: { ability: 'intelligence' },
          },
          level: 1,
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(result.current.allSpells).toEqual([]);
  });

  it('should auto-apply configuration when selections are complete', async () => {
    // Using a class that needs 1 preparation
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'cleric',
            name: 'Cleric',
            spellcasting: { ability: 'wisdom' },
          },
          level: 1,
          abilityScores: {
            wisdom: { score: 10, modifier: 0 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // maxPreparedSpells = 1 + 0 = 1
    act(() => {
      result.current.handleSpellPreparation('spell-1', true);
    });

    expect(result.current.allSelectionsComplete).toBe(true);

    // The hook has a useEffect that calls applySpellcastingFeatures when allSelectionsComplete is true
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            preparedSpells: ['spell-1'],
            advancedSpellcastingComplete: true,
          }),
        }),
      );
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Spellcasting Features Applied',
      }),
    );
  });

  it('should handle Warlock auto-apply with pact magic', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'warlock',
            name: 'Warlock',
            spellcasting: { ability: 'charisma' },
          },
          level: 1, // 2 spells known at lvl 1
          abilityScores: {
            charisma: { score: 10, modifier: 0 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // maxPactSpells = 2
    act(() => {
      result.current.handlePactSpellSelection('spell-1', true);
    });
    act(() => {
      result.current.handlePactSpellSelection('spell-2', true);
    });

    await waitFor(() => {
      expect(result.current.allSelectionsComplete).toBe(true);
    });

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            pactMagicSpells: expect.arrayContaining(['spell-1', 'spell-2']),
            pactSlots: expect.objectContaining({
              maximum: 1,
              level: 1,
            }),
            advancedSpellcastingComplete: true,
          }),
        }),
      );
    });
  });

  it('should handle missing character class name', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: { id: 'unknown' }, // missing name
          level: 1,
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    expect(result.current.allSpells).toEqual([]);
    expect(spellApi.getClassSpells).not.toHaveBeenCalled();
  });

  it('should explicitly call applySpellcastingFeatures for Sorcerer', async () => {
    (useCharacter as any).mockReturnValue({
      state: {
        character: {
          id: 'char-1',
          class: {
            id: 'sorcerer',
            name: 'Sorcerer',
            spellcasting: { ability: 'charisma' },
          },
          level: 3,
          abilityScores: {
            charisma: { score: 16, modifier: 3 },
          },
        },
      },
      dispatch: mockDispatch,
    });

    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    act(() => {
      result.current.handleMetamagicSelection('quickened-spell', true);
    });
    act(() => {
      result.current.handleMetamagicSelection('subtle-spell', true);
    });

    act(() => {
      result.current.applySpellcastingFeatures();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_CHARACTER',
        payload: expect.objectContaining({
          metamagicOptions: expect.arrayContaining(['quickened-spell', 'subtle-spell']),
          sorceryPoints: { maximum: 3, current: 3 },
          advancedSpellcastingComplete: true,
        }),
      }),
    );
  });
});
