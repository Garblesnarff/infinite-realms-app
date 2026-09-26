import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TacticalMapBoard } from './TacticalMapBoard';
import { TacticalMapProvider } from './TacticalMapProvider';

import type { TacticalMap } from './tactical-map-state';

vi.mock('./TacticalMapCanvas', () => ({
  TacticalMapCanvas: ({
    map,
    onCellClick,
  }: {
    map: TacticalMap;
    onCellClick: (point: { x: number; y: number }) => void;
  }) => (
    <div data-testid="canvas">
      {map.width}×{map.height}
      <button onClick={() => onCellClick({ x: 0, y: 0 })}>own</button>
      <button onClick={() => onCellClick({ x: 1, y: 1 })}>destination</button>
    </div>
  ),
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { activeEncounter: { currentTurnParticipantId: 'pc' } } }),
}));

const map = (): TacticalMap => ({
  id: 'map',
  sessionId: 's',
  width: 2,
  height: 2,
  round: 1,
  sceneDescription: 'room',
  cells: Array.from({ length: 2 }, () =>
    Array.from({ length: 2 }, () => ({
      terrain: 'floor',
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'pc',
      x: 0,
      y: 0,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
      name: 'Ada',
    },
    {
      id: 'enemy',
      x: 1,
      y: 0,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
      name: 'Goblin',
    },
  ],
});

describe('tactical map combat flow', () => {
  beforeEach(() => {
    let now = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      now += 80;
      callback(now);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });
  it('mounts, moves/refuses, receives deltas, and unmounts', async () => {
    let moveRequests = 0;
    const fetchMock = vi.fn((url: string) => {
      const isMove = url.includes('/move');
      if (isMove) moveRequests += 1;
      let data: unknown = {
        result: {
          applied: true,
          path: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      };
      if (url.includes('valid-moves')) data = { moves: [{ x: 1, y: 1 }] };
      if (isMove && moveRequests === 1)
        data = {
          result: {
            applied: false,
            refusal: { reason: 'insufficient_movement', needsFeet: 10, hasFeet: 5 },
          },
        };
      return Promise.resolve({
        ok: url.endsWith('/tactical-map') ? false : !isMove || moveRequests > 1,
        json: async () => data,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TacticalMapBoard sessionId="s" />);
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', { detail: { type: 'map_created', map: map() } }),
      ),
    );
    expect(await screen.findByText('2×2')).toBeInTheDocument();
    fireEvent.click(screen.getByText('own'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('valid-moves/pc'),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByText('destination'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/move'), expect.anything()),
    );
    fireEvent.click(screen.getByText('own'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByText('destination'));
    await waitFor(() => expect(moveRequests).toBe(2));
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', {
          detail: { type: 'cell_updated', x: 1, y: 0, changes: { terrain: 'door_open' } },
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', {
          detail: {
            type: 'entity_moved',
            entityId: 'enemy',
            path: [
              { x: 1, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        }),
      ),
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', { detail: { type: 'map_destroyed' } }),
      ),
    );
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument();
  });
  it('keeps one map when the board moves between the rail and the sheet (#2252)', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => null }));
    vi.stubGlobal('fetch', fetchMock);
    const Placement = ({ where }: { where: 'rail' | 'sheet' | 'none' }): JSX.Element => (
      <TacticalMapProvider sessionId="s">
        <div data-testid="rail">{where === 'rail' && <TacticalMapBoard sessionId="s" />}</div>
        <div data-testid="sheet">{where === 'sheet' && <TacticalMapBoard sessionId="s" />}</div>
      </TacticalMapProvider>
    );
    const { rerender } = render(<Placement where="rail" />);
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', { detail: { type: 'map_created', map: map() } }),
      ),
    );
    expect(await screen.findByText('2×2')).toBeInTheDocument();

    // Neither placement is mounted when the delta for the next round arrives.
    rerender(<Placement where="none" />);
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', {
          detail: { type: 'map_created', map: { ...map(), width: 3, height: 3 } },
        }),
      ),
    );
    rerender(<Placement where="sheet" />);

    expect(screen.getByTestId('sheet')).toHaveTextContent('3×3');
    expect(screen.getByTestId('rail')).toBeEmptyDOMElement();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
