import { render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';

import { DiceRollResultFlash } from '../DiceRollResultFlash';

describe('DiceRollResultFlash', () => {
  afterEach(() => document.body.classList.remove('ir-table-look'));
  it('shows the settled die and its breakdown (#84)', () => {
    render(<DiceRollResultFlash die={13} modifier={5} total={18} />);

    const flash = screen.getByTestId('dice-roll-result');
    expect(flash).toHaveAttribute('role', 'status');
    expect(flash).toHaveTextContent('13 + 5 = 18');
  });

  it('signs a negative modifier (#84)', () => {
    render(<DiceRollResultFlash die={13} modifier={-1} total={12} />);

    expect(screen.getByTestId('dice-roll-result')).toHaveTextContent('13 - 1 = 12');
  });

  it('shows a zero modifier without dropping it (#84)', () => {
    render(<DiceRollResultFlash die={13} modifier={0} total={13} />);

    expect(screen.getByTestId('dice-roll-result')).toHaveTextContent('13 + 0 = 13');
  });
  it('shows only the server outcome, including its kept face and Bless die', () => {
    document.body.classList.add('ir-table-look');
    const outcome = {
      rollId: 'roll-1',
      kind: 'attack' as const,
      d20: 20,
      bonus: 5,
      blessDie: 3,
      total: 28,
      hit: true,
      isCritical: true,
    };
    render(<DiceRollResultFlash die={1} modifier={0} total={1} engineOutcome={outcome} />);
    const flash = screen.getByTestId('dice-roll-result');
    expect(flash).toHaveTextContent('20 + 5 + 3 = 28');
    expect(flash).toHaveAttribute('data-engine-critical', 'true');
    expect(screen.getByTestId('engine-roll-seal')).toHaveTextContent('20 CRIT');
  });
  it.each([
    [true, 'SUCCESS'],
    [false, 'FAILED'],
  ] as const)('shows a narrative check verdict', (checkSuccess, label) => {
    document.body.classList.add('ir-table-look');
    render(<DiceRollResultFlash die={10} modifier={2} total={12} checkSuccess={checkSuccess} />);
    expect(screen.getByTestId('engine-roll-seal')).toHaveTextContent(label);
  });
  it('does not show a verdict without a resolved result or in the plain view', () => {
    const view = render(<DiceRollResultFlash die={20} modifier={5} total={25} />);
    expect(screen.queryByTestId('engine-roll-seal')).not.toBeInTheDocument();
    view.rerender(<DiceRollResultFlash die={20} modifier={5} total={25} checkSuccess />);
    expect(screen.queryByTestId('engine-roll-seal')).not.toBeInTheDocument();
  });
  it('does not claim an engine roll result before the server replies', () => {
    document.body.classList.add('ir-table-look');
    render(<DiceRollResultFlash die={20} modifier={5} total={25} awaitingEngine />);
    expect(screen.getByTestId('dice-roll-result')).toHaveTextContent('Resolving');
    expect(screen.getByTestId('dice-roll-result')).not.toHaveTextContent('25');
    expect(screen.queryByTestId('engine-roll-seal')).not.toBeInTheDocument();
  });
});
