/**
 * #1797: the canvas draws at its box's size. A box that is hidden has no size, so the drawing
 * keeps its last buffer; when the box is shown again the picture follows the new size without
 * any map data changing (the browser harness covers the full three rounds).
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TacticalMapCanvas } from './TacticalMapCanvas';

import type { TacticalMap } from './tactical-map-state';

const map: TacticalMap = {
  id: 'm',
  sessionId: 's',
  width: 2,
  height: 2,
  cells: [
    [0, 1].map(() => ({
      terrain: 'floor',
      blocksMovement: false,
      blocksSight: false,
      cover: 0,
      elevation: 0,
    })),
    [0, 1].map(() => ({
      terrain: 'floor',
      blocksMovement: false,
      blocksSight: false,
      cover: 0,
      elevation: 0,
    })),
  ] as never,
  entities: [],
  round: 1,
  sceneDescription: '',
};

let resizeCallback: (() => void) | null = null;
let boxWidth = 0;
let boxHeight = 0;

beforeEach(() => {
  boxWidth = 0;
  boxHeight = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: boxWidth,
      bottom: boxHeight,
      width: boxWidth,
      height: boxHeight,
      toJSON() {},
    } as DOMRect;
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => new Proxy({}, { get: () => () => ({ data: new Uint8ClampedArray(4) }) }),
  ) as never;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resizeCallback = null;
});

describe('TacticalMapCanvas: the picture follows its box (#1797)', () => {
  it('keeps its buffer at a hidden size, then draws at the size the box has when shown', () => {
    const { container } = render(<TacticalMapCanvas map={map} onCellClick={() => {}} />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).not.toBe(0);

    boxWidth = 300;
    boxHeight = 200;
    act(() => resizeCallback?.());

    expect(canvas.width).toBe(Math.round(300 * (window.devicePixelRatio || 1)));
    expect(canvas.height).toBe(Math.round(200 * (window.devicePixelRatio || 1)));
  });

  it('a box that is hidden after being drawn keeps its last picture size', () => {
    const { container } = render(<TacticalMapCanvas map={map} onCellClick={() => {}} />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    boxWidth = 300;
    boxHeight = 200;
    act(() => resizeCallback?.());
    const drawn = canvas.width;

    boxWidth = 0;
    boxHeight = 0;
    act(() => resizeCallback?.());

    expect(canvas.width).toBe(drawn);
  });
});
