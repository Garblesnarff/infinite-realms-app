/**
 * #763 remainder: a Warlock's pact selection starts from the spells picked on
 * the earlier spell step (character.knownSpells), and the count includes them.
 */
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCharacter } from '@/contexts/CharacterContext';
import { classes } from '@/data/classes';
import { halfElf } from '@/data/races/half-elf';
import { useAdvancedSpellcasting } from '@/hooks/useAdvancedSpellcasting';

vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/spellApi', () => ({
  spellApi: { getClassSpells: vi.fn(async () => ({ cantrips: [], spells: [] })) },
}));

afterEach(cleanup);

function mockCharacter(classId: string, knownSpells?: string[], level = 1): void {
  vi.mocked(useCharacter).mockReturnValue({
    state: {
      character: {
        class: classes.find((c) => c.id === classId),
        level,
        race: halfElf,
        knownSpells,
        abilityScores: {
          charisma: { score: 16, modifier: 0, savingThrow: false },
        },
      },
    },
    dispatch: vi.fn(),
  } as never);
}

describe('#763 warlock pact picks come from the earlier spell step', () => {
  it('starts the pact selection with the earlier picks and counts them', async () => {
    mockCharacter('warlock', ['eldritch-blast-id', 'hex-id']);
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    expect(result.current.maxPactSpells).toBe(2);
    expect(result.current.pactMagicSpells).toEqual(['eldritch-blast-id', 'hex-id']);
    expect(result.current.allSelectionsComplete).toBe(true);
  });

  it('caps the initial pact selection at the pact limit', async () => {
    mockCharacter('warlock', ['a', 'b', 'c']);
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    expect(result.current.pactMagicSpells).toEqual(['a', 'b']);
  });

  it('starts empty when the earlier step picked nothing', async () => {
    mockCharacter('warlock', []);
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    expect(result.current.pactMagicSpells).toEqual([]);
    expect(result.current.allSelectionsComplete).toBe(false);
  });

  it('leaves a non-warlock caster with no pact selection', async () => {
    mockCharacter('wizard', ['magic-missile-id']);
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    expect(result.current.pactMagicSpells).toEqual([]);
  });
});
