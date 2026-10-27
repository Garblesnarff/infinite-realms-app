import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CombatSummaryMessage } from '@/components/combat/messages/CombatSummaryMessage';

/**
 * #570: The Combat Summary card must render the server damage-summary payload.
 * Regression test for the "shows then vanishes" bug: the card renders from
 * `message.context.combatData.summary`, which the message queue was stripping
 * on persistence — the card appeared optimistically, then the refetched row
 * (without combatData) rendered as plain "Combat has ended." text.
 */
describe('CombatSummaryMessage', () => {
  const summary = {
    rounds: 2,
    totalDamage: 15,
    participants: [
      { name: 'Hero', damageDealt: 15, damageTaken: 3, status: 'ok' },
      { name: 'Goblin', damageDealt: 3, damageTaken: 15, status: 'dead' },
    ],
    outcome: 'Combat concluded',
  };

  it('renders the summary header, rounds, total damage and outcome', () => {
    render(<CombatSummaryMessage summary={summary} />);
    expect(screen.getByText('Combat Summary')).toBeInTheDocument();
    // Rounds / Total Damage labels with values (values are in the same div as the label)
    const roundsDiv = screen.getByText(/Rounds:/).closest('div');
    expect(roundsDiv).toHaveTextContent('2');
    const damageDiv = screen.getByText(/Total Damage:/).closest('div');
    expect(damageDiv).toHaveTextContent('15');
    expect(screen.getByText('Combat concluded')).toBeInTheDocument();
  });

  it('says the total counts every combatant, not only the player (#974)', () => {
    // Hark N21-020 read "Total Damage 35" as the fighter's own damage; it was 29 dealt plus 6 taken.
    render(<CombatSummaryMessage summary={summary} />);
    const damageDiv = screen.getByText(/Total Damage:/).closest('div');
    expect(damageDiv).toHaveTextContent('Total Damage: 15 (all combatants)');
  });

  it('renders each participant with damage dealt, taken and status', () => {
    render(<CombatSummaryMessage summary={summary} />);
    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('Goblin')).toBeInTheDocument();
    expect(screen.getByText('-3 HP')).toBeInTheDocument();
    expect(screen.getByText('+15 DMG')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('dead')).toBeInTheDocument();
  });

  it('renders the timestamp when provided', () => {
    render(<CombatSummaryMessage summary={summary} timestamp="14:32" />);
    expect(screen.getByText('14:32')).toBeInTheDocument();
  });
});
