import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  REEVES,
  SCHOLAR,
  attackAction,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { parseEngineLine } from '../engine-line-model';
import { EngineLine } from '../EngineLine';

import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';

const playerHit = formatCombatEngineParts(
  attackAction(SCHOLAR, REEVES),
  PLAYER_HITS_ENEMY,
  FIGHT_ROSTER,
)[0].line;
const enemyHit = formatCombatEngineParts(
  attackAction(REEVES, SCHOLAR),
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  { targetHp: true, targetMaxHp: 7 },
)[0].line;

describe('EngineLine (#87)', () => {
  it('shows exactly one outcome pill, the kicker and the math', () => {
    render(<EngineLine model={parseEngineLine(playerHit, { side: 'player' })} />);
    expect(screen.getAllByTestId('engine-line-pill')).toHaveLength(1);
    expect(screen.getByTestId('engine-line-pill').textContent).toBe('Hit');
    expect(screen.getByText('Rules engine')).toBeTruthy();
    expect(screen.getByText('14 + 4 = 18')).toBeTruthy();
    expect(screen.getByTestId('engine-line-badge').className).toContain('bg-infinite-gold');
  });

  it('an NPC row uses the teal badge', () => {
    render(<EngineLine model={parseEngineLine(enemyHit, { side: 'npc' })} />);
    expect(screen.getByTestId('engine-line-badge').className).toContain('bg-infinite-teal');
    expect(screen.getAllByTestId('engine-line-pill')).toHaveLength(1);
  });

  it('prints no "Rules engine" label when showLabel is false', () => {
    render(<EngineLine model={parseEngineLine(playerHit, { side: 'player' })} showLabel={false} />);
    expect(screen.queryByText('Rules engine')).toBeNull();
  });

  it('Enter and Space toggle the raw engine sentence', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <EngineLine model={parseEngineLine(playerHit, { side: 'player' })} />,
    );
    const button = screen.getByRole('button');
    const region = container.querySelector('p') as HTMLParagraphElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(region.hidden).toBe(true);
    expect(region.textContent).toContain('The Scholar rolled 14 + 4 = 18');

    button.focus();
    await user.keyboard('{Enter}');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);

    await user.keyboard(' ');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(region.hidden).toBe(true);

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
