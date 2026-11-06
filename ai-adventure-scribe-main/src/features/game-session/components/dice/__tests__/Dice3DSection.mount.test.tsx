import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dice3DSection } from '../Dice3DSection';

vi.mock('../physics/PhysicsDiceBox', () => ({
  PhysicsDiceBox: () => <canvas data-testid="dice-canvas" />,
}));

describe('dice canvas lifetime', () => {
  it('mounts one canvas for a shown roll and removes it after the tray closes', () => {
    const props = {
      result: null,
      isRolling: false,
      hasRolled: false,
      showAnimation: true,
      soundOn: false,
      onSettled: vi.fn(),
    };
    const view = render(<Dice3DSection {...props} />);
    expect(screen.queryByTestId('dice-canvas')).not.toBeInTheDocument();
    view.rerender(<Dice3DSection {...props} hasRolled isRolling />);
    expect(screen.getAllByTestId('dice-canvas')).toHaveLength(1);
    view.unmount();
    expect(screen.queryByTestId('dice-canvas')).not.toBeInTheDocument();
  });
});
