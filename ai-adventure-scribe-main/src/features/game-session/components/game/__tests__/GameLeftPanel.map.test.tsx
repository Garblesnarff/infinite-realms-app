import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GameLeftPanel } from '../game-content/GameLeftPanel';

vi.mock('../overhaul/LeftRailLive', () => ({
  LeftRailLive: () => <div data-testid="left-rail" />,
}));
vi.mock('../../tactical/TacticalMapProvider', () => ({
  useTacticalMapContext: () => ({ map: { id: 'map' } }),
}));
vi.mock('../../tactical/TacticalMapBoard', () => ({
  TacticalMapBoard: ({ canvasClassName }: { canvasClassName?: string }) => (
    <div data-testid="tactical-map-board" data-canvas={canvasClassName} />
  ),
}));

describe('GameLeftPanel tactical map (#2252)', () => {
  it('puts the tactical map at the top of the rail when the layout places it there', () => {
    render(
      <GameLeftPanel
        sessionId="s"
        isCollapsed={false}
        onToggle={vi.fn()}
        onOpenSheet={vi.fn()}
        showMap
      />,
    );

    const board = screen.getByTestId('tactical-map-board');
    expect(board.compareDocumentPosition(screen.getByTestId('left-rail'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('places the character before the map in the Table look, including DOM order', () => {
    render(
      <GameLeftPanel
        sessionId="s"
        isCollapsed={false}
        tableLook
        onToggle={vi.fn()}
        onOpenSheet={vi.fn()}
        showMap
      />,
    );
    const board = screen.getByTestId('tactical-map-board');
    expect(screen.getByTestId('left-rail').compareDocumentPosition(board)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('expands the existing Table map and closes it with Escape', () => {
    render(
      <GameLeftPanel
        sessionId="s"
        isCollapsed={false}
        tableLook
        onToggle={vi.fn()}
        onOpenSheet={vi.fn()}
        showMap
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open full map →', hidden: true }));
    expect(screen.getByRole('dialog', { name: 'Tactical map', hidden: true })).toBeInTheDocument();
    expect(screen.getAllByTestId('tactical-map-board')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Tactical map', hidden: true }), {
      key: 'Escape',
    });
    expect(
      screen.queryByRole('dialog', { name: 'Tactical map', hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('leaves the map out when the rail is not a column of its own', () => {
    render(
      <GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} onOpenSheet={vi.fn()} />,
    );

    expect(screen.queryByTestId('tactical-map-board')).not.toBeInTheDocument();
    expect(screen.getByTestId('left-rail')).toBeInTheDocument();
  });
});
