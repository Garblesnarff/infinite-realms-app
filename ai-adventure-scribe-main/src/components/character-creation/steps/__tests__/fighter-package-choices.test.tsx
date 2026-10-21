import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import cases from '../../../../../shared/test-fixtures/fighter-package-choices.json';
import EquipmentSelection from '../EquipmentSelection';

import type { Character } from '@/types/character';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { backgrounds } from '@/data/backgroundOptions';
import { fighter } from '@/data/classes/fighter';
import { mapWizardEquipmentToInventory } from '@/hooks/use-character-save';
import { transformEquipmentForStorage } from '@/utils/characterTransformations';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({ scrollToNavigation: vi.fn() }),
}));
let character: Character;
function Probe() {
  const { state, dispatch } = useCharacter();
  const initialized = React.useRef(false);
  React.useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    dispatch({
      type: 'SET_CHARACTER',
      payload: {
        class: fighter,
        background: backgrounds.find((b) => b.id === 'outlander'),
        equipment: [],
        fightingStyles: ['Great Weapon Fighting'],
      } as unknown as Character,
    });
  }, [dispatch]);
  character = state.character as Character;
  return null;
}
function Harness({ show = true }: { show?: boolean }) {
  return (
    <CharacterProvider>
      <Probe />
      {show && <EquipmentSelection />}
    </CharacterProvider>
  );
}
describe('#921 Fighter package choices', () => {
  for (const fixture of cases) {
    it(`${fixture.name}: selects, remounts and serializes the exact route fixture equipment`, () => {
      const { rerender } = render(<Harness />);
      fireEvent.change(screen.getByLabelText('Fighter weapon option'), {
        target: { value: fixture.mode },
      });
      fireEvent.change(screen.getByLabelText('First martial weapon'), {
        target: { value: fixture.first },
      });
      if (fixture.mode === 'two')
        fireEvent.change(screen.getByLabelText('Second martial weapon'), {
          target: { value: fixture.second },
        });
      expect(character.equipment).toEqual(fixture.equipmentNames);
      expect(character.currency?.gp).toBe(0);
      const equipment = transformEquipmentForStorage(
        { ...character, inventory: mapWizardEquipmentToInventory(character) },
        '00000000-0000-0000-0000-000000000000',
      );
      expect(equipment).toEqual(fixture.body.equipment);
      rerender(<Harness show={false} />);
      rerender(<Harness />);
      expect(screen.getByLabelText('Fighter weapon option')).toHaveValue(fixture.mode);
      expect(screen.getByLabelText('First martial weapon')).toHaveValue(fixture.first);
      if (fixture.mode === 'two')
        expect(screen.getByLabelText('Second martial weapon')).toHaveValue(fixture.second);
    });
  }
});
