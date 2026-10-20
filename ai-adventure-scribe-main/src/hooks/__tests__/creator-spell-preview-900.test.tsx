import { render, renderHook, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdvancedSpellcastingSelection from '@/components/character-creation/steps/AdvancedSpellcastingSelection';
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
describe('#900 creator spell preview', () => {
  it.each([
    ['cleric', 2],
    ['druid', 2],
    ['bard', 3],
    ['warlock', 3],
  ])('%s derives its modifier from final scores', async (id, modifier) => {
    vi.mocked(useCharacter).mockReturnValue({
      state: {
        character: {
          class: classes.find((c) => c.id === id),
          level: 1,
          race: halfElf,
          abilityScores: {
            charisma: { score: 14, modifier: 0, savingThrow: false },
            wisdom: { score: 15, modifier: -9, savingThrow: false },
          },
        },
      },
      dispatch: vi.fn(),
    } as never);
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));
    expect(result.current.abilityModifier).toBe(modifier);
    if (id === 'bard') return; // Bard has no advanced-selection overview at level 1.
    render(<AdvancedSpellcastingSelection />);
    await waitFor(() => expect(screen.getByText('Spell Save DC')).toBeInTheDocument());
    expect(screen.getByText('Spell Save DC').previousElementSibling).toHaveTextContent(
      String(10 + Number(modifier)),
    );
    expect(screen.getByText('Spell Attack Bonus').previousElementSibling).toHaveTextContent(
      `+${2 + Number(modifier)}`,
    );
  });
});
