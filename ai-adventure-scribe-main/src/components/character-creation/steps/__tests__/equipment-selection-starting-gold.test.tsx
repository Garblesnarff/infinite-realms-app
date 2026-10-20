/**
 * #901: the Starting Gold grant must be whole gp at the producer.
 *
 * The monk average is 12.5 (5d4 x 1). Picking the gold card without rolling
 * used to put 12.5 into currency.gp, which the create route passed into the
 * integer gold_pieces column — a 500 and a lost character. Renders the real
 * EquipmentSelection inside the real CharacterProvider, seeds it with the
 * real Monk/Outlander data, and clicks the real cards.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import EquipmentSelection from '../EquipmentSelection';

import type { Character } from '@/types/character';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { backgrounds } from '@/data/backgroundOptions';
import { monk } from '@/data/classes/monk';
import { startingGoldByClass } from '@/data/equipmentOptions';
import { elf } from '@/data/races/elf';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({ scrollToNavigation: vi.fn(), scrollToTop: vi.fn() }),
}));

function seedCharacter(): Character {
  const woodElf = elf.subraces?.find((s) => s.id === 'wood-elf');
  const outlander = backgrounds.find((b) => b.id === 'outlander');
  if (!woodElf || !outlander) throw new Error('seed data missing');
  return {
    name: 'Monk 901',
    race: elf,
    subrace: woodElf,
    class: monk,
    background: outlander,
    level: 1,
    equipment: [],
  } as Character;
}

function Probe() {
  const { state, dispatch } = useCharacter();
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    dispatch({ type: 'SET_CHARACTER', payload: seedCharacter() });
  }, [dispatch]);
  return (
    <output data-testid="probe">
      {JSON.stringify({
        gp: state.character?.currency?.gp ?? null,
        equipment: state.character?.equipment ?? null,
      })}
    </output>
  );
}

function renderStep() {
  return render(
    <CharacterProvider>
      <Probe />
      <EquipmentSelection />
    </CharacterProvider>,
  );
}

function probeState(): { gp: number | null; equipment: string[] | null } {
  return JSON.parse(screen.getByTestId('probe').textContent || '{}');
}

describe('EquipmentSelection starting gold (#901)', () => {
  it('grants whole gp when the gold card is picked without rolling', () => {
    renderStep();

    fireEvent.click(screen.getByRole('heading', { name: 'Starting Gold' }));

    const { gp, equipment } = probeState();
    // The table's monk average really is fractional — that is the bug input.
    expect(startingGoldByClass['monk'].average).toBe(12.5);
    expect(gp).toBe(12);
    expect(Number.isInteger(gp)).toBe(true);
    // The background kit (incl. the Staff weapon) is what the gold option keeps.
    expect(equipment).toContain('Staff');
  });

  it('rolls whole gp', () => {
    renderStep();

    // Picking the card grants the average; the roller's reset clears it,
    // and only then does the Roll button appear — the real click path.
    fireEvent.click(screen.getByRole('heading', { name: 'Starting Gold' }));
    fireEvent.click(screen.getByRole('button', { name: /Roll Again/ }));
    expect(probeState().gp).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /Roll for Gold/ }));

    const { gp } = probeState();
    expect(gp).not.toBeNull();
    expect(Number.isInteger(gp)).toBe(true);
    // 5d4 x 1 for a monk.
    expect(gp as number).toBeGreaterThanOrEqual(5);
    expect(gp as number).toBeLessThanOrEqual(20);
  });
});
