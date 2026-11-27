import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SceneHeader } from './SceneHeader';

/** #1754 Done means 1 and 7: the place plaque is the map's entry point. */
describe('Place plaque as the map button', () => {
  it('is a button named with the place, and passes itself back for focus', () => {
    const onOpenMap = vi.fn();
    render(<SceneHeader title="The Chasm" location="Old Toll Bridge" onOpenMap={onOpenMap} />);
    const plaque = screen.getByRole('button', { name: 'Open map, you are at Old Toll Bridge' });
    expect(plaque).toHaveTextContent('EXPLORING');
    expect(plaque).toHaveClass('min-h-11');
    fireEvent.click(plaque);
    expect(onOpenMap).toHaveBeenCalledWith(plaque);
  });

  it('opens with Enter or Space from the keyboard', async () => {
    const user = userEvent.setup();
    const onOpenMap = vi.fn();
    render(<SceneHeader title="The Chasm" location="Reedhaven" onOpenMap={onOpenMap} />);
    const plaque = screen.getByRole('button', { name: 'Open map, you are at Reedhaven' });
    plaque.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onOpenMap).toHaveBeenCalledTimes(2);
  });

  it('in a fight the same plaque opens the fight board, not the map', () => {
    const onOpenMap = vi.fn();
    const onOpenFightBoard = vi.fn();
    render(
      <SceneHeader
        title="The Chasm"
        location="Reedhaven"
        onOpenMap={onOpenMap}
        onOpenFightBoard={onOpenFightBoard}
        combat={{
          active: true,
          round: 3,
          combatants: [{ id: 'foe', name: 'Spider', initiative: 10, isActive: true }],
        }}
      />,
    );
    const plaque = screen.getByRole('button', { name: 'Open fight board' });
    expect(plaque).toHaveTextContent('Round 3');
    fireEvent.click(plaque);
    expect(onOpenFightBoard).toHaveBeenCalledTimes(1);
    expect(onOpenMap).not.toHaveBeenCalled();
  });

  it('without a map handler (player-made campaign) the plaque is not a button', () => {
    render(<SceneHeader title="The Chasm" location="A cave I made up" />);
    expect(screen.getByText('A cave I made up')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open map/ })).not.toBeInTheDocument();
  });
});
