import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../../../../shared/test-fixtures/dying-participant-wire';
import { DyingPanel } from '../DyingPanel';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';

/** The Scholar as the client holds her after the server counted 2 failures (#2518). */
const scholar = mapAuthoritativeCombat({
  encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentTurnOrder: 0 },
  participants: [DYING_SCHOLAR_PARTICIPANT],
} as never).participants[0];

describe('DyingPanel', () => {
  it('server records 2 failures: the panel shows ✕✕○ and says so in words', () => {
    render(
      <DyingPanel
        name={scholar.name}
        state="dying"
        successes={scholar.deathSaves.successes}
        failures={scholar.deathSaves.failures}
        isOwnTurn={false}
      />,
    );

    expect(screen.getByTestId('dying-panel-title').textContent).toBe('The Scholar is dying');
    expect(screen.getByRole('img', { name: '0 of 3 successes, 2 of 3 failures' })).toBeTruthy();
    // A screen reader hears the count, not symbols.
    expect(screen.getByText('0 successes and 2 failures of 3')).toBeTruthy();
  });

  it('on the enemy turn it says the player cannot act, and offers no roll', () => {
    render(
      <DyingPanel
        name="The Scholar"
        state="dying"
        successes={1}
        failures={0}
        isOwnTurn={false}
        onRoll={vi.fn()}
      />,
    );

    expect(screen.getByTestId('dying-panel-hint').textContent).toBe(
      'You cannot act. Wait for your turn.',
    );
    expect(screen.getByRole('img', { name: '1 of 3 successes, 0 of 3 failures' })).toBeTruthy();
    expect(screen.queryByTestId('dying-panel-roll')).toBeNull();
    expect(screen.queryByTestId('dying-panel-waiting')).toBeNull();
  });

  it('on the player’s own turn it says the save has no modifiers, and the button rolls it', () => {
    const onRoll = vi.fn();
    render(
      <DyingPanel
        name="The Scholar"
        state="dying"
        successes={0}
        failures={2}
        isOwnTurn
        onRoll={onRoll}
      />,
    );

    expect(screen.getByTestId('dying-panel-hint').textContent).toBe(
      'Death saving throw — roll a d20',
    );
    expect(screen.getByText('No modifiers. 10 or higher saves.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dying-panel-roll'));
    expect(onRoll).toHaveBeenCalledTimes(1);
  });

  it('shows no second button while the roll prompt is open in the tray', () => {
    render(
      <DyingPanel
        name="The Scholar"
        state="dying"
        successes={0}
        failures={2}
        isOwnTurn
        onRoll={vi.fn()}
        promptOpen
      />,
    );

    expect(screen.queryByTestId('dying-panel-roll')).toBeNull();
    expect(screen.getByText(/Roll the d20 above/)).toBeTruthy();
  });

  it('a stable character gets the grey stable panel: no pips, no roll', () => {
    render(
      <DyingPanel name="The Scholar" state="stable" successes={3} failures={0} isOwnTurn={false} />,
    );

    expect(screen.getByTestId('dying-panel-title').textContent).toBe('The Scholar is stable');
    expect(screen.queryByTestId('dying-panel-failures')).toBeNull();
    expect(screen.queryByTestId('dying-panel-roll')).toBeNull();
    expect(screen.getByText(/You wake with 1 HP after 1d4 hours/)).toBeInTheDocument();
    expect(screen.getByText('STABLE')).toBeInTheDocument();
  });

  it('names the creature who is acting, and shows each failure the engine counted', () => {
    render(
      <DyingPanel
        name="The Scholar"
        state="dying"
        successes={1}
        failures={2}
        isOwnTurn={false}
        waitingOn="Captain Sarah Reeves"
      />,
    );

    expect(screen.getByTestId('dying-panel-waiting')).toHaveTextContent(
      'Captain Sarah Reeves is acting',
    );
    expect(screen.getByRole('img', { name: '1 of 3 successes, 2 of 3 failures' })).toBeTruthy();
  });

  it('shows the bridge countdown and a bar, and announces only the start and 10 s', () => {
    const view = render(
      <DyingPanel
        name="The Scholar"
        state="dying"
        successes={0}
        failures={0}
        isOwnTurn
        autoRollSecondsLeft={38}
      />,
    );

    expect(screen.getByTestId('dying-panel-countdown')).toHaveTextContent('Auto-roll in 38 s');
    expect(screen.getByTestId('dying-panel-countdown-live')).toHaveTextContent('Auto-roll in 38 s');

    view.rerender(
      <DyingPanel
        name="The Scholar"
        state="dying"
        successes={0}
        failures={0}
        isOwnTurn
        autoRollSecondsLeft={37}
      />,
    );
    expect(screen.getByTestId('dying-panel-countdown')).toHaveTextContent('Auto-roll in 37 s');
    expect(screen.getByTestId('dying-panel-countdown-live')).toHaveTextContent('Auto-roll in 38 s');

    view.rerender(
      <DyingPanel
        name="The Scholar"
        state="dying"
        successes={0}
        failures={0}
        isOwnTurn
        autoRollSecondsLeft={10}
      />,
    );
    expect(screen.getByTestId('dying-panel-countdown-live')).toHaveTextContent('Auto-roll in 10 s');
  });
});
