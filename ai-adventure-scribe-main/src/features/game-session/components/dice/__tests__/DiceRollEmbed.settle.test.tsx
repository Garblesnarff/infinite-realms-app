import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiceRollEmbed } from '../DiceRollEmbed';

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({ play: vi.fn(), unload: vi.fn() })),
}));
vi.mock('../Dice3DSection', () => ({
  Dice3DSection: ({ result, onSettled }: { result: unknown; onSettled: () => void }) =>
    result ? <button onClick={onSettled}>Dice stopped</button> : null,
}));
vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    roll: () => ({
      expression: '1d20+4',
      total: 11,
      rolls: [{ dice: 20, value: 7 }],
      modifiers: 4,
      naturalRoll: 7,
      timestamp: 1,
    }),
  },
}));

describe('dice result timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('keeps the result and callback hidden until the die settles', () => {
    const onRoll = vi.fn();
    render(<DiceRollEmbed expression="1d20+4" autoRoll onRoll={onRoll} />);
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByText('Total 11')).not.toBeInTheDocument();
    expect(onRoll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dice stopped' }));
    expect(screen.getByText('Total 11')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(onRoll).toHaveBeenCalledOnce();
  });
});
