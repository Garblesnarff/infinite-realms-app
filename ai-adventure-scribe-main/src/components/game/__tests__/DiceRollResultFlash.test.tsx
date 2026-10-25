import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DiceRollResultFlash } from '../DiceRollResultFlash';

describe('DiceRollResultFlash', () => {
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
});
