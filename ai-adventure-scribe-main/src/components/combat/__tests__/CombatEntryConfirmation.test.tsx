import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CombatEntryConfirmation } from '../CombatEntryConfirmation';

import { Z_INDEX } from '@/constants/z-index';
import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('CombatEntryConfirmation', () => {
  it('offers the entry Strike and decline actions before seating', () => {
    const confirm = vi.fn();
    const decline = vi.fn();

    render(
      <CombatEntryConfirmation
        confirmation={{
          spec: {
            actorLabel: 'The Storyteller',
            combatantLabels: ['Vance'],
            initiativeRoll: null,
            initiativeModifier: 2,
          },
          confirm,
          decline,
        }}
      />,
    );

    expect(screen.getByText('Combat is about to begin')).toBeInTheDocument();
    expect(
      screen.getByText('Strike at Vance? Your initiative is rolled after you confirm.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Initiative: rolled after confirmation')).not.toBeInTheDocument();
    const overlay = screen.getByTestId('combat-entry-confirmation-overlay');
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay).toHaveClass('fixed', 'bottom-40', 'left-1/2');
    expect(overlay).toHaveStyle({ zIndex: Z_INDEX.COMBAT_ENTRY_CONFIRMATION });
    const strike = screen.getByRole('button', { name: '[Strike]' });
    const declineButton = screen.getByRole('button', { name: '[Do something else]' });
    const card = screen.getByRole('alert', { name: 'Combat entry confirmation' });
    expect(card).toHaveClass('bg-card', 'border-infinite-gold', 'shadow-2xl');
    expect(card).not.toHaveClass('bg-card/95', 'border-infinite-gold/60');
    expect(strike).toHaveAttribute('data-action', 'confirm');
    expect(declineButton).toHaveAttribute('data-action', 'decline');
    fireEvent.click(strike);
    fireEvent.click(declineButton);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[CombatEntry] confirmation popup mounted',
      expect.objectContaining({ actorLabel: 'The Storyteller' }),
    );
    expect(logger.info).toHaveBeenCalledWith('[CombatEntry] confirmation popup resolved', {
      actorLabel: 'The Storyteller',
      confirmed: true,
      action: 'confirm',
    });
    expect(logger.info).toHaveBeenCalledWith('[CombatEntry] confirmation popup resolved', {
      actorLabel: 'The Storyteller',
      confirmed: false,
      action: 'decline',
    });
  });
});
