import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { RollTray, RollTraySlotProvider } from '../game-content/roll-tray-slot';

const Harness: React.FC = () => {
  const [slot, setSlot] = React.useState<HTMLDivElement | null>(null);
  return (
    <RollTraySlotProvider value={slot}>
      <div data-testid="stream">
        <RollTray>
          <button type="button">Roll Dice</button>
        </RollTray>
      </div>
      <div data-testid="slot" ref={setSlot} />
    </RollTraySlotProvider>
  );
};

describe('RollTray (#2252)', () => {
  it('renders the prompt in the slot, outside the stream that rendered it', () => {
    render(<Harness />);

    const roll = screen.getByRole('button', { name: 'Roll Dice' });
    expect(screen.getByTestId('slot')).toContainElement(roll);
    expect(screen.getByTestId('stream')).not.toContainElement(roll);
  });

  it('renders in place, in normal flow, when there is no slot', () => {
    render(
      <div data-testid="list">
        <RollTray>
          <button type="button">Roll Dice</button>
        </RollTray>
      </div>,
    );

    const tray = screen.getByTestId('roll-tray');
    expect(screen.getByTestId('list')).toContainElement(tray);
    expect(tray.className).not.toMatch(/fixed|absolute|sticky/);
  });
});
