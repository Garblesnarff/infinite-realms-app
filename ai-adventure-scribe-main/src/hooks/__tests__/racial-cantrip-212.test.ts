/**
 * #212: Records today's (broken) behavior for QA-042 and QA-043.
 *
 * QA-042: High Elf Wizard picks 3 class cantrips; the racial bonus cantrip
 * shares the same pool, so the 4th pick is blocked ("3 of 1 selected").
 * The racial bonus must be its own pick on top of class cantrips (4 total).
 *
 * QA-043: Cantrips appear in the Advanced Spellcasting preparation list
 * and can consume the prep slot. Only level 1+ spells should be preparable.
 *
 * These tests FAIL on main (recording the bug) and PASS after the fix.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Character } from '@/types/character';
import type * as SpellValidation from '@/utils/spell-validation';

import { useAdvancedSpellcasting } from '@/hooks/useAdvancedSpellcasting';
import { useSpellSelection } from '@/hooks/useSpellSelection';

// #212: count validateSpellSelectionAsync calls to prove the render loop is
// gone. The mock wraps the real implementation.
const validateAsyncSpy = vi.fn();
vi.mock('@/utils/spell-validation', async (importOriginal) => {
  const mod = (await importOriginal()) as unknown as typeof SpellValidation;
  return {
    ...mod,
    validateSpellSelectionAsync: (
      ...args: Parameters<typeof mod.validateSpellSelectionAsync>
    ) => {
      validateAsyncSpy(...args);
      return mod.validateSpellSelectionAsync(...args);
    },
  };
});


// Mock character context with a High Elf Wizard
const mockDispatch = vi.fn();
const highElfWizard = {
  id: 'test-char-1',
  name: 'Test Wizard',
  race: { name: 'Elf' },
  subrace: { name: 'High Elf' },
  class: {
    id: 'wizard',
    name: 'Wizard',
    spellcasting: { ability: 'intelligence' },
  },
  level: 1,
  abilityScores: {
    intelligence: { score: 16, modifier: 3 },
  } as Character['abilityScores'],
  cantrips: [],
  knownSpells: [],
} as unknown as Character;

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: highElfWizard },
    dispatch: mockDispatch,
  }),
}));

vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getClassSpells: vi.fn().mockResolvedValue({
      cantrips: [
        { id: 'fire-bolt', name: 'Fire Bolt', level: 0 },
        { id: 'mage-hand', name: 'Mage Hand', level: 0 },
        { id: 'prestidigitation', name: 'Prestidigitation', level: 0 },
        { id: 'acid-splash', name: 'Acid Splash', level: 0 },
      ],
      spells: [
        { id: 'magic-missile', name: 'Magic Missile', level: 1 },
        { id: 'shield', name: 'Shield', level: 1 },
      ],
    }),
  },
}));

vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    saveCharacterSpells: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe('QA-042: racial bonus cantrip is its own pool (#212)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a High Elf Wizard can pick 3 class cantrips + 1 racial bonus (4 total)', async () => {
    const { result } = renderHook(() => useSpellSelection());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // Pick 3 class cantrips (wizard gets 3 at level 1)
    act(() => {
      result.current.toggleCantrip('fire-bolt');
    });
    act(() => {
      result.current.toggleCantrip('mage-hand');
    });
    act(() => {
      result.current.toggleCantrip('prestidigitation');
    });

    expect(result.current.selectedCantrips).toHaveLength(3);

    // The racial bonus cantrip must be a SEPARATE pick, tracked separately
    // from the class cantrips. Today the hook has a single shared pool:
    // the Racial tab's bonus section receives the full selectedCantrips
    // array and locks at "3 of 1 selected".
    const hook = result.current as unknown as Record<string, unknown>;
    expect(
      typeof hook.toggleBonusCantrip,
      'QA-042: useSpellSelection must expose a separate toggleBonusCantrip for the racial pool',
    ).toBe('function');
    expect(
      hook.selectedBonusCantrips,
      'QA-042: useSpellSelection must expose selectedBonusCantrips',
    ).toBeDefined();

    act(() => {
      (hook.toggleBonusCantrip as (id: string) => void)('acid-splash');
    });
    // Re-read result.current after act (the hook object is recreated).
    const updated = result.current as unknown as Record<string, unknown>;
    expect((updated.selectedBonusCantrips as string[]).length).toBe(1);
    // Class pool unchanged by the racial pick.
    expect(result.current.selectedCantrips).toHaveLength(3);
  });

  it('reopening with 4 saved cantrips splits 3 class + 1 bonus', async () => {
    // Simulate a saved character carrying all 4 cantrips (3 class + 1 racial).
    // The mocked context reads highElfWizard directly, so set its cantrips.
    const savedCantrips = ['fire-bolt', 'mage-hand', 'prestidigitation', 'acid-splash'];
    (highElfWizard as { cantrips: string[] }).cantrips = savedCantrips;

    const { result } = renderHook(() => useSpellSelection());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // The init effect must split, not dump everything into the class pool.
    expect(result.current.selectedCantrips).toHaveLength(3);
    expect(result.current.selectedCantrips).toContain('fire-bolt');
    const bonus = (
      result.current as unknown as { selectedBonusCantrips: string[] }
    ).selectedBonusCantrips;
    expect(bonus).toHaveLength(1);
    expect(bonus).toContain('acid-splash');

    // Restore for other tests.
    (highElfWizard as { cantrips: string[] }).cantrips = [];
  });
});

describe('QA-043: cantrips are never preparable (#212)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('the preparation list excludes level-0 spells', async () => {
    const { result } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    const cantripsInList = result.current.availableSpells.filter(
      (s) => s.level === 0,
    );
    // Today: cantrips ARE in the list (bug). After fix: none.
    expect(cantripsInList).toHaveLength(0);
  });
});

describe('QA-042: one toggle → one save (#212)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAsyncSpy.mockClear();
  });

  it('toggling the bonus cantrip does not loop validation', async () => {
    const { result } = renderHook(() => useSpellSelection());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // Pick 1 class cantrip first so the combined list is non-trivial.
    act(() => {
      result.current.toggleCantrip('fire-bolt');
    });

    validateAsyncSpy.mockClear();
    mockDispatch.mockClear();

    // One bonus toggle. Without the useMemo on allSelectedCantrips, the
    // validation effect re-fires every render (fresh array identity) and
    // validateSpellSelectionAsync is called dozens of times. With the memo,
    // it runs once for the real change.
    act(() => {
      const hook = result.current as unknown as {
        toggleBonusCantrip: (id: string) => void;
      };
      hook.toggleBonusCantrip('acid-splash');
    });

    // Allow effects to settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // The loop drives validation, not just the save: without the memo this
    // count is in the dozens (fails on 771f14d0); with the memo it is 1-2.
    expect(validateAsyncSpy.mock.calls.length).toBeLessThan(5);

    // And the save itself fires once with the combined, deduped list.
    const saves = mockDispatch.mock.calls.filter(
      ([action]) =>
        action.type === 'UPDATE_CHARACTER' && 'cantrips' in action.payload,
    );
    expect(saves.length).toBe(1);
    const savedCantrips = saves[0][0].payload.cantrips as string[];
    expect(savedCantrips.sort()).toEqual(['acid-splash', 'fire-bolt']);
  });

  it('a duplicate id across pools saves once', async () => {
    const { result } = renderHook(() => useSpellSelection());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // Toggle the same cantrip in both the class and bonus pools.
    // (Simulates a Drow toggling an automatic cantrip.)
    act(() => {
      result.current.toggleCantrip('fire-bolt');
      const hook = result.current as unknown as {
        toggleBonusCantrip: (id: string) => void;
      };
      hook.toggleBonusCantrip('fire-bolt');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const saves = mockDispatch.mock.calls.filter(
      ([action]) =>
        action.type === 'UPDATE_CHARACTER' && 'cantrips' in action.payload,
    );
    const lastSave = saves[saves.length - 1][0].payload.cantrips as string[];
    const fireBoltCount = lastSave.filter((id) => id === 'fire-bolt').length;
    expect(fireBoltCount).toBe(1);
  });
});
