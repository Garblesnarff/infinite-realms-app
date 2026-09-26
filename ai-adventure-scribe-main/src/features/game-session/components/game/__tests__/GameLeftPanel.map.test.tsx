import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GameLeftPanel } from '../game-content/GameLeftPanel';

vi.mock('../overhaul/LeftRailLive', () => ({
  LeftRailLive: () => <div data-testid="left-rail" />,
}));
vi.mock('../../tactical/TacticalMapBoard', () => ({
  TacticalMapBoard: ({ canvasClassName }: { canvasClassName?: string }) => (
    <div data-testid="tactical-map-board" data-canvas={canvasClassName} />
  ),
}));

describe('GameLeftPanel tactical map (#2252)', () => {
  it('puts the tactical map at the top of the rail when the layout places it there', () => {
    render(<GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} showMap />);

    const board = screen.getByTestId('tactical-map-board');
    expect(board.compareDocumentPosition(screen.getByTestId('left-rail'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('leaves the map out when the rail is not a column of its own', () => {
    render(<GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} />);

    expect(screen.queryByTestId('tactical-map-board')).not.toBeInTheDocument();
    expect(screen.getByTestId('left-rail')).toBeInTheDocument();
  });
});
