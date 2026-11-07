/**
 * #1402: the Equipment tab offers "Choose starting equipment" only for a hero whose
 * equipment really loaded and has no rows. An unset list, a non-empty list, or a failed
 * equipment request must not show the control.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InventoryTab from '../InventoryTab';

import type { Character } from '@/types/character';

vi.mock('@/hooks/use-magic-item-attunement', () => ({
  useMagicItemAttunement: () => ({
    attuneToItem: vi.fn(),
    removeAttunement: vi.fn(),
    getAttunementSummary: () => ({ attunedCount: 0, maxAttunementSlots: 3, isAtCapacity: false }),
    isAttuning: () => false,
  }),
}));

const CONTROL = 'Choose starting equipment';

function hero(inventory: Character['inventory']): Character {
  return {
    id: 'hero-1402',
    name: 'Hero',
    inventory,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  } as unknown as Character;
}

describe('InventoryTab starting-equipment control (#1402)', () => {
  it('shows the control for a loaded hero with an empty equipment list', () => {
    render(<InventoryTab character={hero([])} onUpdate={vi.fn()} />);
    expect(screen.getByRole('button', { name: CONTROL })).toBeInTheDocument();
  });

  it('does not show the control when the inventory is unset', () => {
    render(<InventoryTab character={hero(undefined)} onUpdate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: CONTROL })).not.toBeInTheDocument();
  });

  it('does not show the control when the hero already has items', () => {
    render(
      <InventoryTab
        character={hero([{ itemId: 'Dagger', quantity: 1, equipped: true }])}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: CONTROL })).not.toBeInTheDocument();
  });

  it('does not show the control when the equipment request failed', () => {
    render(<InventoryTab character={hero([])} onUpdate={vi.fn()} equipmentUnavailable />);
    expect(screen.queryByRole('button', { name: CONTROL })).not.toBeInTheDocument();
  });
});
