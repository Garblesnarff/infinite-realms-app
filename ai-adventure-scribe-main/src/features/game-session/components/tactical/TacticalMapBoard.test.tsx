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
const combatStateHolder = vi.hoisted(() => ({
  current: {
    activeEncounter: {
      id: 'enc-1',
      currentTurnParticipantId: 'pc',
    } as { id: string; currentTurnParticipantId: string; currentRound?: number } | null,
  },
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: combatStateHolder.current }),
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
  it('names the missing provider instead of casting a null context (#2685 step 1)', () => {
    expect(() => render(<TacticalMapBoard sessionId="s" />)).toThrow(
      'TacticalMapBoard requires TacticalMapProvider',
    );
  });
  it('mounts, moves/refuses, receives deltas, and unmounts', async () => {
    let moveRequests = 0;
    let intentBody: unknown;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const isMove = url.includes('/v1/combat/enc-1/intent');
      if (isMove) {
        moveRequests += 1;
        intentBody = JSON.parse(String(init?.body));
      }
      let data: unknown = { accepted: true, result: { applied: true } };
      if (url.includes('/status')) data = { encounter: { version: 3 } };
      if (url.includes('valid-moves')) data = { moves: [{ x: 1, y: 1 }] };
      if (isMove && moveRequests === 1)
        data = {
          error: 'Movement refused',
          details: { reason: 'insufficient_movement', needsFeet: 10, hasFeet: 5 },
        };
      return Promise.resolve({
        ok: url.endsWith('/tactical-map') ? false : !isMove || moveRequests > 1,
        status: isMove && moveRequests === 1 ? 422 : 200,
        headers: new Headers(),
        json: async () => data,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <TacticalMapProvider sessionId="s">
        <TacticalMapBoard sessionId="s" />
      </TacticalMapProvider>,
    );
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
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/combat/enc-1/intent'),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByText('own'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByText('destination'));
    await waitFor(() => expect(moveRequests).toBe(2));
    expect(intentBody).toMatchObject({
      intent: { type: 'move', actorId: 'pc', x: 1, y: 1 },
      source: 'player',
      origin: 'action_bar',
    });
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

  it('labels and describes the collapse control (#2343 item 17)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: async () => null })),
    );
    render(
      <TacticalMapProvider sessionId="s">
        <TacticalMapBoard sessionId="s" />
      </TacticalMapProvider>,
    );
    await act(async () =>
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', { detail: { type: 'map_created', map: map() } }),
      ),
    );

    const collapseButton = await screen.findByRole('button', { name: 'Collapse tactical map' });
    fireEvent.pointerMove(collapseButton);
    expect(
      await screen.findByRole('tooltip', { name: 'Collapse tactical map' }),
    ).toBeInTheDocument();
  });

  it('reads the round from the authoritative encounter, not the stale map field (#179 item 3)', async () => {
    combatStateHolder.current = {
      activeEncounter: { id: 'enc-1', currentTurnParticipantId: 'pc', currentRound: 3 },
    };
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ ok: false, json: async () => null })),
      );
      render(
        <TacticalMapProvider sessionId="s">
          <TacticalMapBoard sessionId="s" />
        </TacticalMapProvider>,
      );
      await act(async () =>
        window.dispatchEvent(
          // The map payload still carries round 1: the map fetch happens once per
          // session and no delta ever updates its round field (NT-046).
          new CustomEvent('tactical-map-delta', { detail: { type: 'map_created', map: map() } }),
        ),
      );
      expect(await screen.findByText(/Initiative · round 3/)).toBeInTheDocument();
    } finally {
      combatStateHolder.current = {
        activeEncounter: { id: 'enc-1', currentTurnParticipantId: 'pc' },
      };
    }
  });

  it('falls back to the map round when no encounter is active (#179 item 3)', async () => {
    combatStateHolder.current = { activeEncounter: null };
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ ok: false, json: async () => null })),
      );
      render(
        <TacticalMapProvider sessionId="s">
          <TacticalMapBoard sessionId="s" />
        </TacticalMapProvider>,
      );
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent('tactical-map-delta', { detail: { type: 'map_created', map: map() } }),
        ),
      );
      expect(await screen.findByText(/Initiative · round 1/)).toBeInTheDocument();
    } finally {
      combatStateHolder.current = {
        activeEncounter: { id: 'enc-1', currentTurnParticipantId: 'pc' },
      };
    }
  });
});
