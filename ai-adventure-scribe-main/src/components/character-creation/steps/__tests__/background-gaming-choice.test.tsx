import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../../../shared/test-fixtures/background-gaming-cards.json';
import BackgroundSelection from '../BackgroundSelection';

import type { Character } from '@/types/character';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { mapWizardEquipmentToInventory } from '@/hooks/use-character-save';
import { transformCharacterData } from '@/utils/character/data-transformers';
import { calculateRollWithBreakdown } from '@/utils/character/roll-breakdown';
import { transformEquipmentForStorage } from '@/utils/characterTransformations';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({ scrollToNavigation: vi.fn() }),
}));
let character: Character;
function Probe() {
  character = useCharacter().state.character as Character;
  return null;
}
describe('#893 concrete background gaming choice', () => {
  it('keeps the selected choice on remount and serializes the exact creation equipment', () => {
    function Harness({ show = true }) {
      return (
        <CharacterProvider>
          <Probe />
          {show && <BackgroundSelection />}
        </CharacterProvider>
      );
    }
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Select Criminal background' }));
    fireEvent.change(screen.getByLabelText('Background gaming set'), {
      target: { value: 'Gaming set (cards)' },
    });
    expect(character.toolProficiencies).toEqual(["Thieves' tools", 'Gaming set (cards)']);
    const equipment = transformEquipmentForStorage(
      {
        ...character,
        equipment: ['Dice set'],
        inventory: mapWizardEquipmentToInventory({ ...character, equipment: ['Dice set'] }),
      },
      '00000000-0000-0000-0000-000000000000',
    );
    expect(equipment).toEqual(fixture.equipment);
    expect(character.toolProficiencies?.join(',')).toBe(fixture.tool_proficiencies);
    rerender(<Harness show={false} />);
    rerender(<Harness />);
    expect(screen.getByLabelText('Background gaming set')).toHaveValue('Gaming set (cards)');
  });
  it('grants only cards even with both sets, and retains proficiency after removal', () => {
    for (const inventory of [
      [],
      [
        { itemId: 'deck-of-cards', quantity: 1 },
        { itemId: 'dice-set', quantity: 1 },
      ],
    ]) {
      const saved = {
        ...transformCharacterData(
          { ...fixture, id: 'saved' } as unknown as Parameters<typeof transformCharacterData>[0],
          null,
          [],
        ),
        id: 'saved',
        level: 1,
        inventory,
        abilityScores: { charisma: { score: 14, modifier: 2 } },
      } as unknown as Character;
      expect(
        calculateRollWithBreakdown(saved, 'check', 'charisma', 'Gaming set (cards)').isProficient,
      ).toBe(true);
      expect(
        calculateRollWithBreakdown(saved, 'check', 'charisma', 'Gaming set (dice)').isProficient,
      ).toBe(false);
      expect(mapWizardEquipmentToInventory(saved)).toEqual(inventory);
    }
  });
});
