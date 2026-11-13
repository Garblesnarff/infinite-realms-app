import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { GameLeftPanel } from '../game-content/GameLeftPanel';

const combatHolder = vi.hoisted(() => ({
  current: undefined as { state: { isInCombat: boolean } } | undefined,
}));

vi.mock('@/contexts/CombatContext', () => ({
  useOptionalCombat: () => combatHolder.current,
}));

vi.mock('../overhaul/LeftRailLive', () => ({
  LeftRailLive: () => <div data-testid="left-rail" />,
}));

/**
 * A real TacticalMap shape (tactical-map-state.ts): cells, entities, scene.
 * The sketch reads cells, entities and sceneDescription, so the fixture carries all three.
 */
const testMap = vi.hoisted(() => ({
  id: 'map',
  sessionId: 's',
  width: 3,
  height: 2,
  cells: [
    [
      { terrain: 'wall', blocksMovement: true, blocksSight: true, cover: 3, elevation: 0 },
      { terrain: 'floor', blocksMovement: false, blocksSight: false, cover: 0, elevation: 0 },
      { terrain: 'water', blocksMovement: false, blocksSight: false, cover: 0, elevation: 0 },
    ],
    [
      { terrain: 'floor', blocksMovement: false, blocksSight: false, cover: 0, elevation: 0 },
      { terrain: 'door_open', blocksMovement: false, blocksSight: false, cover: 0, elevation: 0 },
      { terrain: 'floor', blocksMovement: false, blocksSight: false, cover: 0, elevation: 0 },
    ],
  ],
  entities: [
    { id: 'pc-1', x: 1, y: 0, size: 'medium', type: 'pc', speedFeet: 30, movementRemaining: 30 },
    {
      id: 'm-1',
      x: 2,
      y: 1,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
  round: 1,
  sceneDescription: 'A damp cellar.',
}));
vi.mock('../../tactical/TacticalMapProvider', () => ({
  useTacticalMapContext: () => ({ map: testMap }),
}));
vi.mock('../../tactical/TacticalMapBoard', () => ({
  TacticalMapBoard: ({ canvasClassName }: { canvasClassName?: string }) => (
    <div data-testid="tactical-map-board" data-canvas={canvasClassName} />
  ),
}));

describe('GameLeftPanel tactical map (#2252)', () => {
  afterEach(() => {
    combatHolder.current = undefined;
  });

  it('puts the character rail before the map sketch', () => {
    render(
      <GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} onOpenSheet={vi.fn()} />,
    );

    const sketch = screen.getByRole('img', { name: 'Map sketch', hidden: true });
    expect(screen.getByTestId('left-rail').compareDocumentPosition(sketch)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('places the character before the map in the Table look, including DOM order', () => {
    // The battle grid only renders in a fight: pin combat on for this render.
    combatHolder.current = { state: { isInCombat: true } };
    render(
      <GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} onOpenSheet={vi.fn()} />,
    );
    const board = screen.getByTestId('tactical-map-board');
    expect(screen.getByTestId('left-rail').compareDocumentPosition(board)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('expands the existing Table map and closes it with Escape', () => {
    // The expand control lives on the battle grid, so this render is a fight.
    combatHolder.current = { state: { isInCombat: true } };
    render(
      <GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} onOpenSheet={vi.fn()} />,
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

  it('draws the chat-mode sketch when no fight is running', () => {
    render(
      <GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} onOpenSheet={vi.fn()} />,
    );

    expect(screen.getByText('MAP SKETCH')).toBeInTheDocument();
    expect(screen.queryByTestId('tactical-map-board')).not.toBeInTheDocument();
    expect(screen.getByTestId('left-rail')).toBeInTheDocument();
  });

  it('shows the map as a MAP SKETCH in chat mode, and the battle grid in combat', () => {
    // Chat mode draws the sketch. A fight draws the battle grid. Combat is the only gate.
    const { unmount } = render(
      <GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} onOpenSheet={vi.fn()} />,
    );
    const sketch = screen.getByRole('img', { name: 'Map sketch', hidden: true });
    expect(sketch).toBeInTheDocument();
    expect(screen.getByText('MAP SKETCH')).toBeInTheDocument();
    expect(screen.getByText('A damp cellar.')).toBeInTheDocument();
    expect(sketch.querySelectorAll('circle')).toHaveLength(2);
    expect(screen.queryByTestId('tactical-map-board')).not.toBeInTheDocument();
    unmount();

    combatHolder.current = { state: { isInCombat: true } };
    render(
      <GameLeftPanel sessionId="s" isCollapsed={false} onToggle={vi.fn()} onOpenSheet={vi.fn()} />,
    );
    expect(screen.queryByText('MAP SKETCH')).not.toBeInTheDocument();
    expect(screen.getByTestId('tactical-map-board')).toBeInTheDocument();
  });
});
