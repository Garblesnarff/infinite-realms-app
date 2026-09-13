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

    expect(screen.getByText('Initiative: rolled after confirmation')).toBeInTheDocument();
    const overlay = screen.getByTestId('combat-entry-confirmation-overlay');
    expect(overlay).toHaveClass('fixed', 'bottom-24', 'left-1/2');
    expect(overlay).toHaveStyle({ zIndex: Z_INDEX.POPOVER });
    fireEvent.click(screen.getByRole('button', { name: '[Strike]' }));
    fireEvent.click(screen.getByRole('button', { name: '[Do something else]' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[CombatEntry] confirmation popup mounted',
      expect.objectContaining({ actorLabel: 'The Storyteller' }),
    );
    expect(logger.info).toHaveBeenCalledWith('[CombatEntry] confirmation popup resolved', {
      actorLabel: 'The Storyteller',
      confirmed: true,
    });
    expect(logger.info).toHaveBeenCalledWith('[CombatEntry] confirmation popup resolved', {
      actorLabel: 'The Storyteller',
      confirmed: false,
    });
  });
});
