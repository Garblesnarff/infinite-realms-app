import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { namedHostilePending } from '../../../../shared/test-fixtures/unnamed-hostile-entry';
import { CombatEntryConfirmation } from '../CombatEntryConfirmation';

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
    expect(overlay.parentElement).toHaveAttribute('data-testid', 'roll-tray');
    expect(overlay).toHaveClass('w-full');
    expect(overlay).not.toHaveClass('fixed', 'absolute', 'sticky');
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

  it.each([
    [namedHostilePending.combatants.map((combatant) => combatant.name), 'Chitinous Hunter'],
    [[], 'the opposing side'],
  ])('for a fight the DM left unnamed (#2532), labels %j read "Strike at %s?"', (labels, shown) => {
    const spec = { actorLabel: 'The Storyteller', initiativeRoll: null, initiativeModifier: 2 };
    render(
      <CombatEntryConfirmation
        confirmation={{
          spec: { ...spec, combatantLabels: labels },
          confirm: vi.fn(),
          decline: vi.fn(),
        }}
      />,
    );

    expect(
      screen.getByText(`Strike at ${shown}? Your initiative is rolled after you confirm.`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hostile creature|unknown creature/i)).not.toBeInTheDocument();
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
  it('logs its label and choice lists as separate arrays, so the logger never prints [Circular] (#2445)', () => {
    const candidates = ['Captain Sarah Reeves'];
    render(
      <CombatEntryConfirmation
        confirmation={{
          // The picker (`holdForTargetChoice`) hands one array to both fields.
          spec: {
            actorLabel: 'The Scholar',
            combatantLabels: candidates,
            targetChoices: candidates,
            spellLabel: 'Chill Touch',
            initiativeRoll: null,
            initiativeModifier: 1,
          },
          confirm: vi.fn(),
          decline: vi.fn(),
        }}
      />,
    );

    // The mocked logger keeps earlier tests' calls: this test's mount log is the last one.
    const mountLogs = vi
      .mocked(logger.info)
      .mock.calls.filter(([message]) => message === '[CombatEntry] confirmation popup mounted');
    const logged = mountLogs[mountLogs.length - 1][1] as {
      combatantLabels: string[];
      targetChoices: string[];
    };
    expect(logged.targetChoices).toEqual(['Captain Sarah Reeves']);
    expect(logged.combatantLabels).toEqual(['Captain Sarah Reeves']);
    expect(logged.targetChoices).not.toBe(logged.combatantLabels);
  });
});
