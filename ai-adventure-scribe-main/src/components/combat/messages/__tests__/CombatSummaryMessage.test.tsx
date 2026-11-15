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

  it('labels each hit with the event round and keeps foe damage out of the total (#974)', () => {
    // Player hits 8, 10 and 11 across three rounds. The foe's 6 in round 2 is its own row.
    render(
      <CombatSummaryMessage
        summary={{
          rounds: 3,
          totalDamage: 29,
          hits: [
            { round: 1, side: 'player', damage: 8, label: 'R1' },
            { round: 2, side: 'player', damage: 10, label: 'R2' },
            { round: 2, side: 'npc', damage: 6, label: 'R2' },
            { round: 3, side: 'player', damage: 11, label: 'R3' },
          ],
          participants: [
            { name: 'Hero', damageDealt: 29, damageTaken: 6, status: 'ok' },
            { name: 'Goblin', damageDealt: 6, damageTaken: 29, status: 'dead' },
          ],
          outcome: 'Combat concluded',
        }}
      />,
    );
    expect(screen.getAllByText('R2')).toHaveLength(2);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R3')).toBeInTheDocument();
    const damageDiv = screen.getByText(/Total Damage:/).closest('div');
    expect(damageDiv).toHaveTextContent('Total Damage: 29');
    expect(damageDiv).not.toHaveTextContent('35');
    expect(screen.queryByText(/all combatants/)).toBeNull();
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
