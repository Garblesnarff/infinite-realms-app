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

  it('names the declared target and lists the rest of the roster separately', () => {
    render(
      <CombatEntryConfirmation
        confirmation={{
          spec: {
            actorLabel: 'The Storyteller',
            combatantLabels: ['Professor Emil Darkwater', 'Captain Sarah Reeves'],
            declaredTargets: ['Professor Emil Darkwater'],
            otherCombatants: ['Captain Sarah Reeves'],
            initiativeRoll: null,
            initiativeModifier: 2,
          },
          confirm: vi.fn(),
          decline: vi.fn(),
        }}
      />,
    );

    expect(
      screen.getByText(
        'Strike at Professor Emil Darkwater? Your initiative is rolled after you confirm.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Also joining the fight: Captain Sarah Reeves.')).toBeInTheDocument();
    expect(screen.queryByText(/Strike at .*Captain Sarah Reeves/)).not.toBeInTheDocument();
    expect(logger.info).toHaveBeenCalledWith(
      '[CombatEntry] confirmation popup mounted',
      expect.objectContaining({
        declaredTargets: ['Professor Emil Darkwater'],
        otherCombatants: ['Captain Sarah Reeves'],
      }),
    );
  });

  it('falls back to the roster when no target was declared and omits the second line', () => {
    render(
      <CombatEntryConfirmation
        confirmation={{
          spec: {
            actorLabel: 'The Storyteller',
            combatantLabels: ['Professor Emil Darkwater', 'Captain Sarah Reeves'],
            initiativeRoll: null,
            initiativeModifier: 2,
          },
          confirm: vi.fn(),
          decline: vi.fn(),
        }}
      />,
    );

    expect(
      screen.getByText(
        'Strike at Professor Emil Darkwater, Captain Sarah Reeves? Your initiative is rolled after you confirm.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Also joining the fight:/)).not.toBeInTheDocument();
  });

  it('asks who an attack spell is for when it named nobody (#2341), and reports the pick', () => {
    const confirm = vi.fn();
    const decline = vi.fn();

    render(
      <CombatEntryConfirmation
        confirmation={{
          spec: {
            actorLabel: 'The Scholar',
            combatantLabels: ['Valerius', 'Professor Darkwater'],
            targetChoices: ['Valerius', 'Professor Darkwater'],
            spellLabel: 'Fire Bolt',
            initiativeRoll: null,
            initiativeModifier: 1,
          },
          confirm,
          decline,
        }}
      />,
    );

    expect(
      screen.getByText('Who is Fire Bolt for? Your initiative is rolled after you choose.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '[Strike]' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[Strike Professor Darkwater]' }));
    expect(confirm).toHaveBeenCalledWith('Professor Darkwater');
    fireEvent.click(screen.getByRole('button', { name: '[Do something else]' }));
    expect(decline).toHaveBeenCalledTimes(1);
  });
});
