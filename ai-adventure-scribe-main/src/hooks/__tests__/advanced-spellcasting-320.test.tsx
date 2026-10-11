/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #320 proving tests (P1 wizard: Step 11 freeze / racial cantrip tab).
 *
 * CR-003: ticking prepared spells to the max must apply once — the
 * auto-apply effect re-firing every render froze the page under a toast
 * flood. The test renders, ticks to max, then re-renders (what a real
 * context update does) and asserts no further dispatches/toasts.
 * CR-008: a High Elf non-spellcaster's bonus cantrip options come from the
 * wizard list, not the (empty) class list.
 * CR-004/CR-012: the spell catalog path never files a level-1 spell as a
 * cantrip (data-path guard).
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAdvancedSpellcasting } from '../useAdvancedSpellcasting';
import { useAvailableSpells } from '../useAvailableSpells';

import { validateAdvancedSpellcasting } from '@/components/character-creation/wizard/wizard-spell-validators';
import { useCharacter } from '@/contexts/CharacterContext';
import { useToast } from '@/hooks/use-toast';
import { spellApi } from '@/services/spellApi';
import { getSpellById, getSpellsByIds } from '@/utils/spell-lookup';

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

// Fixture shape follows the existing useAdvancedSpellcasting.test.tsx
// character objects, which mirror the wizard's CharacterContext state.
const clericL1 = {
  id: 'char-1',
  class: {
    id: 'cleric',
    name: 'Cleric',
    spellcasting: { ability: 'wisdom' },
  },
  level: 1,
  abilityScores: {
    wisdom: { score: 15, modifier: 2 },
  },
};

const level1Spells = [
  { id: 'bane', name: 'Bane', level: 1, ritual: false },
  { id: 'bless', name: 'Bless', level: 1, ritual: false },
  { id: 'cure-wounds', name: 'Cure Wounds', level: 1, ritual: false },
];

describe('#320 CR-003 — Step 11 does not loop when selections complete', () => {
  const mockDispatch = vi.fn();
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as any).mockReturnValue({ toast: mockToast });
    (spellApi.getClassSpells as any).mockResolvedValue({ cantrips: [], spells: level1Spells });
    (useCharacter as any).mockReturnValue({
      state: { character: clericL1 },
      dispatch: mockDispatch,
    });
  });

  it('applies once when prepared spells reach max, and stays quiet on re-render', async () => {
    const { result, rerender } = renderHook(() => useAdvancedSpellcasting());

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });
    // Cleric L1, WIS +2 → 1 + 2 = 3 prepared.
    expect(result.current.maxPreparedSpells).toBe(3);

    act(() => {
      result.current.handleSpellPreparation('bane', true);
      result.current.handleSpellPreparation('bless', true);
      result.current.handleSpellPreparation('cure-wounds', true);
    });

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });
    expect(mockToast).toHaveBeenCalledTimes(1);

    // A real context update re-renders the step; the auto-apply effect must
    // not fire again from referentially-unstable inputs.
    rerender();
    rerender();
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('validator message uses the singular for one prepared spell', () => {
    const character: any = {
      ...clericL1,
      abilityScores: { wisdom: { score: 10, modifier: 0 } },
      preparedSpells: [],
    };
    const res = validateAdvancedSpellcasting(character);
    expect(res.isValid).toBe(false);
    expect(res.message).toBe('Please prepare 1 spell for your Cleric');
  });
});

describe('#320 CR-008 — racial bonus cantrip options come from the source list', () => {
  const wizardCantrips = [
    { id: 'acid-splash', name: 'Acid Splash', level: 0 },
    { id: 'fire-bolt', name: 'Fire Bolt', level: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (spellApi.getClassSpells as any).mockImplementation(async (className: string) => {
      if (className.toLowerCase() === 'wizard') {
        return { cantrips: wizardCantrips, spells: [] };
      }
      return { cantrips: [], spells: [] };
    });
  });

  it('High Elf Ranger (non-spellcaster) gets wizard cantrips as bonus options', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({
        isSpellcaster: false,
        className: 'Ranger',
        level: 1,
        bonusCantripClassName: 'wizard',
      }),
    );

    await waitFor(() => {
      expect(result.current.filteredBonusCantrips.length).toBe(2);
    });
    expect(result.current.filteredCantrips).toHaveLength(0);
    expect(result.current.filteredBonusCantrips.map((s) => s.id)).toEqual([
      'acid-splash',
      'fire-bolt',
    ]);
  });

  it('same-class bonus source reuses the class list without a second fetch', async () => {
    const { result } = renderHook(() =>
      useAvailableSpells({
        isSpellcaster: true,
        className: 'Wizard',
        level: 1,
        bonusCantripClassName: 'wizard',
      }),
    );

    await waitFor(() => {
      expect(result.current.isLoadingSpells).toBe(false);
    });
    expect(spellApi.getClassSpells).toHaveBeenCalledTimes(1);
    expect(result.current.filteredBonusCantrips).toEqual(result.current.filteredCantrips);
  });
});

describe('#320 CR-004/CR-012 — server-written display names resolve to real spells', () => {
  // The server syncs the legacy character spell columns with display names
  // (string_agg(spells.name)), so the sheet can receive 'Animal Friendship'
  // instead of 'animal-friendship'. The old guard tests asserted on the
  // static catalog split, which was never broken, so they passed on unfixed
  // code. These fail on unfixed code: the lookup fell through to a level-0
  // fallback stub and the sheet filed the level-1 spell under Cantrips.
  it("resolves 'Animal Friendship' to the level-1 druid spell, not a stub", () => {
    const spell = getSpellById('Animal Friendship');
    expect(spell?.id).toBe('animal-friendship');
    expect(spell?.level).toBe(1);
    expect(spell?.description).not.toMatch(/Spell data not available/);
  });

  it("resolves 'Burning Hands' / 'alarm' by name or id without a stub", () => {
    expect(getSpellById('Burning Hands')?.level).toBe(1);
    expect(getSpellById('alarm')?.level).toBe(1);
  });

  it('a level-1 spell stored by name is never filed as a cantrip', () => {
    const spells = getSpellsByIds(['Animal Friendship', 'Alarm', 'Burning Hands']);
    expect(spells).toHaveLength(3);
    expect(spells.every((s) => s.level !== 0)).toBe(true);
    expect(spells.map((s) => s.id).sort()).toEqual(
      ['alarm', 'animal-friendship', 'burning-hands'].sort(),
    );
  });
});
