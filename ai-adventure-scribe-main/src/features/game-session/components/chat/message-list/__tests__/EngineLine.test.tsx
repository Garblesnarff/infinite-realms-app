import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  ENEMY_FAILS_SAVE,
  ENEMY_HITS_PLAYER,
  ENEMY_MISSES_PLAYER,
  ENEMY_SAVES,
  ENEMY_SAVE_SPELL_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_CRITS_ENEMY,
  PLAYER_HITS_ENEMY,
  PLAYER_MISSES_ENEMY,
  PLAYER_PASSES_ENEMY_SAVE,
  REEVES,
  SCHOLAR,
  attackAction,
  spellAction,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { parseEngineLine } from '../engine-line-model';
import { EngineLine } from '../EngineLine';

import {
  formatCombatEngineParts,
  formatRefusedSpellPart,
} from '@/services/combat/combat-outcome-transcript';

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

  it('seals an enemy hit red and an enemy failed save gold, matching the card (#1457)', () => {
    document.body.classList.add('ir-table-look');
    try {
      const enemyHit = formatCombatEngineParts(
        attackAction(REEVES, SCHOLAR),
        ENEMY_HITS_PLAYER,
        FIGHT_ROSTER,
        { targetHp: true, targetMaxHp: 7 },
      )[0];
      const failedSave = formatCombatEngineParts(
        spellAction(SCHOLAR, REEVES),
        ENEMY_FAILS_SAVE,
        FIGHT_ROSTER,
      )[0];
      const { unmount } = render(
        <EngineLine model={parseEngineLine(enemyHit.line, { roster: FIGHT_ROSTER })} />,
      );
      expect(screen.getByTestId('engine-line')).toHaveAttribute('data-outcome', 'enemy-hit');
      expect(screen.getByTestId('engine-roll-seal')).toHaveAttribute('data-seal-tone', 'red');
      expect(enemyHit.card.badge?.tone).toBe('red');
      unmount();
      render(<EngineLine model={parseEngineLine(failedSave.line, { roster: FIGHT_ROSTER })} />);
      expect(screen.getByTestId('engine-line')).toHaveAttribute('data-outcome', 'failed-save');
      expect(screen.getByTestId('engine-roll-seal')).toHaveAttribute('data-seal-tone', 'gold');
      expect(failedSave.card.badge?.tone).toBe('gold');
    } finally {
      document.body.classList.remove('ir-table-look');
    }
  });

  it('seals a miss and a refusal red, a pass gold, and a line with no verdict slate (#1457)', () => {
    document.body.classList.add('ir-table-look');
    try {
      const onYou = { targetHp: true, targetMaxHp: 7 };
      const rows = [
        {
          part: formatCombatEngineParts(
            attackAction(SCHOLAR, REEVES),
            PLAYER_HITS_ENEMY,
            FIGHT_ROSTER,
          )[0],
          outcome: 'hit',
          tone: 'gold',
          badge: 'gold',
        },
        {
          part: formatCombatEngineParts(
            attackAction(SCHOLAR, REEVES),
            PLAYER_CRITS_ENEMY,
            FIGHT_ROSTER,
          )[0],
          outcome: 'critical',
          tone: 'gold',
          badge: 'gold',
        },
        {
          part: formatCombatEngineParts(
            attackAction(SCHOLAR, REEVES),
            PLAYER_MISSES_ENEMY,
            FIGHT_ROSTER,
          )[0],
          outcome: 'miss',
          tone: 'red',
          badge: 'grey',
        },
        {
          part: formatCombatEngineParts(
            attackAction(REEVES, SCHOLAR),
            ENEMY_MISSES_PLAYER,
            FIGHT_ROSTER,
          )[0],
          outcome: 'enemy-miss',
          tone: 'red',
          badge: 'grey',
        },
        {
          part: formatCombatEngineParts(spellAction(SCHOLAR, REEVES), ENEMY_SAVES, FIGHT_ROSTER)[0],
          outcome: 'saved',
          tone: 'slate',
          badge: 'grey',
        },
        {
          part: formatCombatEngineParts(
            spellAction(REEVES, SCHOLAR),
            PLAYER_PASSES_ENEMY_SAVE,
            FIGHT_ROSTER,
          )[0],
          outcome: 'pass',
          tone: 'gold',
          badge: 'grey',
        },
        {
          part: formatCombatEngineParts(
            spellAction(REEVES, SCHOLAR),
            ENEMY_SAVE_SPELL_HITS_PLAYER,
            FIGHT_ROSTER,
            onYou,
          )[0],
          outcome: 'fail',
          tone: 'red',
          badge: 'red',
        },
        {
          part: formatRefusedSpellPart(
            SCHOLAR.id,
            'Chill Touch',
            'it is not your turn',
            FIGHT_ROSTER,
          ),
          outcome: 'refused',
          tone: 'red',
          badge: 'grey',
        },
      ];
      for (const row of rows) {
        const { unmount } = render(
          <EngineLine model={parseEngineLine(row.part.line, { roster: FIGHT_ROSTER })} />,
        );
        expect(screen.getByTestId('engine-line'), row.outcome).toHaveAttribute(
          'data-outcome',
          row.outcome,
        );
        expect(screen.getByTestId('engine-roll-seal'), row.outcome).toHaveAttribute(
          'data-seal-tone',
          row.tone,
        );
        expect(row.part.card.badge?.tone, row.outcome).toBe(row.badge);
        unmount();
      }

      render(
        <EngineLine
          model={parseEngineLine('⚙️ Engine: Captain Sarah Reeves moved to (3, 4).', {
            roster: FIGHT_ROSTER,
          })}
        />,
      );
      expect(screen.getByTestId('engine-line')).toHaveAttribute('data-outcome', 'move');
      expect(screen.queryByTestId('engine-roll-seal')).toBeNull();
      expect(screen.getByTestId('engine-line-pill').className).toContain('ir-wax-seal--slate');
    } finally {
      document.body.classList.remove('ir-table-look');
    }
  });

  // The initiative line exactly as the server writes it (server-bun combat-entry-gate.test.ts).
  it('seals an initiative line slate with the initiative total and drops the NOTE pill (#1521)', () => {
    document.body.classList.add('ir-table-look');
    try {
      const initiativeLine =
        '⚙️ Engine: Initiative: 5 (nat 4+1) — Faceless Stalker 2: 15 + 0 = 15. Faceless Stalker 1: 11 + 0 = 11. You: 4 + 1 = 5 (you rolled). Goblin: 7 + 0 = 7.';
      render(<EngineLine model={parseEngineLine(initiativeLine, { side: 'player' })} />);
      expect(screen.getByTestId('engine-line')).toHaveAttribute('data-outcome', 'info');
      const seal = screen.getByTestId('engine-roll-seal');
      expect(seal).toHaveAttribute('data-seal-tone', 'slate');
      expect(seal).toHaveTextContent(/^5$/);
      expect(screen.queryByTestId('engine-line-pill')).toBeNull();
    } finally {
      document.body.classList.remove('ir-table-look');
    }
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
