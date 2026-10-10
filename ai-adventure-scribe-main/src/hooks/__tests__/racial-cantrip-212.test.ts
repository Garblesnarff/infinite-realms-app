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

import { useAdvancedSpellcasting } from '@/hooks/useAdvancedSpellcasting';
import { useSpellSelection } from '@/hooks/useSpellSelection';


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
  });

  it('toggling the bonus cantrip dispatches a single combined save', async () => {
    const { result } = renderHook(() => useSpellSelection());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });

    // Pick 1 class cantrip first so the combined list is non-trivial.
    act(() => {
      result.current.toggleCantrip('fire-bolt');
    });

    mockDispatch.mockClear();

    // One bonus toggle → the auto-save effect should dispatch exactly once
    // with the combined cantrip list (class + bonus). A render-loop would
    // dispatch repeatedly.
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

    const saves = mockDispatch.mock.calls.filter(
      ([action]) =>
        action.type === 'UPDATE_CHARACTER' && 'cantrips' in action.payload,
    );
    // Exactly one save for the one toggle (not a loop).
    expect(saves.length).toBe(1);
    const savedCantrips = saves[0][0].payload.cantrips as string[];
    expect(savedCantrips.sort()).toEqual(['acid-splash', 'fire-bolt']);
  });
});
