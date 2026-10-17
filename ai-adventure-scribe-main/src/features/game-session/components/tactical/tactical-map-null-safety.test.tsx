import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TacticalMapCanvas } from './TacticalMapCanvas';
import { TacticalMapProvider } from './TacticalMapProvider';

import type { TacticalMap, TacticalEntity } from './tactical-map-state';

const stubContext = (): CanvasRenderingContext2D =>
  ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;

const mapWithIdlessEntity = (): TacticalMap => ({
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
      id: undefined as unknown as string,
      x: 0,
      y: 0,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
      name: 'Goblin',
    } as unknown as TacticalEntity,
  ],
});

describe('tactical map null safety (#748)', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => stubContext() as unknown as RenderingContext,
    );
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('draws a map whose entity has no id while animation is null', () => {
    expect(() =>
      render(
        <TacticalMapCanvas map={mapWithIdlessEntity()} animation={null} onCellClick={() => {}} />,
      ),
    ).not.toThrow();
  });

  it('ignores a null action in a tactical_action_queue and a null forced move', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: async () => null })),
    );
    render(
      <TacticalMapProvider sessionId="s">
        <div />
      </TacticalMapProvider>,
    );
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', {
          detail: {
            type: 'tactical_action_queue',
            actions: [null],
          },
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tactical-map-delta', {
          detail: {
            type: 'aoe_cast',
            state: 'player-confirmed',
            actorId: 'pc',
            spellId: 'spell',
            geometry: {
              shape: 'sphere',
              sizeFeet: 5,
              origin: { x: 0, y: 0 },
              direction: null,
              cells: [{ x: 0, y: 0 }],
            },
            forcedMoves: [null],
          },
        }),
      );
    });
  });
});
