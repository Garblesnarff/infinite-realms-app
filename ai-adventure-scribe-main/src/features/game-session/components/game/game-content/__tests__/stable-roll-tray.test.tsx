import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiceRollEmbed } from '../../../dice/DiceRollEmbed';
import { RollTray, RollTraySlotProvider, useStableRollTraySlot } from '../roll-tray-slot';

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({ play: vi.fn(), unload: vi.fn() })),
}));
vi.mock('../../../dice/Dice3DSection', () => ({
  Dice3DSection: ({ result, onSettled }: { result: unknown; onSettled: () => void }) =>
    result ? <button onClick={onSettled}>Dice stopped</button> : null,
}));
vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    roll: () => ({
      expression: '1d20',
      total: 7,
      rolls: [{ dice: 20, value: 7 }],
      modifiers: 0,
      naturalRoll: 7,
      timestamp: 1,
    }),
  },
}));

function Fixture({ onRoll }: { onRoll: ReturnType<typeof vi.fn> }): React.JSX.Element {
  const [table, setTable] = React.useState(false);
  const [inline, setInline] = React.useState<HTMLDivElement | null>(null);
  const [side, setSide] = React.useState<HTMLDivElement | null>(null);
  const slot = useStableRollTraySlot(table ? side : inline);
  return (
    <>
      <button onClick={() => setTable((current) => !current)}>Switch look</button>
      {table ? (
        <div data-testid="table-host" ref={setSide} />
      ) : (
        <div data-testid="plain-host" ref={setInline} />
      )}
      <RollTraySlotProvider value={slot}>
        <RollTray>
          <DiceRollEmbed expression="1d20" autoRoll onRoll={onRoll} />
        </RollTray>
      </RollTraySlotProvider>
    </>
  );
}

describe('stable roll tray', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('moves an unsettled die without delivering or remounting it', () => {
    const onRoll = vi.fn();
    render(<Fixture onRoll={onRoll} />);
    act(() => vi.advanceTimersByTime(1500));
    const die = screen.getByRole('button', { name: 'Dice stopped' });
    expect(screen.getByTestId('plain-host')).toContainElement(die);
    fireEvent.click(screen.getByRole('button', { name: 'Switch look' }));
    expect(screen.getByTestId('table-host')).toContainElement(die);
    expect(onRoll).not.toHaveBeenCalled();
    fireEvent.click(die);
    act(() => vi.advanceTimersByTime(2000));
    expect(onRoll).toHaveBeenCalledOnce();
  });
});
