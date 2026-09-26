import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TacticalMapProvider } from './TacticalMapProvider';

import type { TacticalMap } from './tactical-map-state';

const map = (id: string): TacticalMap => ({
  id,
  sessionId: 's',
  width: 1,
  height: 1,
  round: 1,
  sceneDescription: 'room',
  cells: [
    [{ terrain: 'floor', blocksMovement: false, blocksSight: false, cover: 0, elevation: 0 }],
  ],
  entities: [],
});

const createMap = async (id: string): Promise<void> =>
  act(async () => {
    window.dispatchEvent(
      new CustomEvent('tactical-map-delta', { detail: { type: 'map_created', map: map(id) } }),
    );
  });

const setDesktop = (matches: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as never;
};

describe('TacticalMapProvider rail opening (#2252)', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: async () => null })),
    );
  });
  afterEach(() => {
    window.matchMedia = original;
  });

  it('opens the left rail once per new map on a desktop-width screen', async () => {
    setDesktop(true);
    const setLeftCollapsed = vi.fn();
    render(
      <TacticalMapProvider sessionId="s" setLeftCollapsed={setLeftCollapsed}>
        <div />
      </TacticalMapProvider>,
    );

    await createMap('fight-1');
    expect(setLeftCollapsed).toHaveBeenCalledTimes(1);
    expect(setLeftCollapsed).toHaveBeenCalledWith(false);

    // The same fight's map again (a re-sync) does not reopen a rail the player closed.
    await createMap('fight-1');
    expect(setLeftCollapsed).toHaveBeenCalledTimes(1);

    await createMap('fight-2');
    expect(setLeftCollapsed).toHaveBeenCalledTimes(2);
  });

  it('leaves the rail alone at narrow widths, where the Map button opens the map', async () => {
    setDesktop(false);
    const setLeftCollapsed = vi.fn();
    render(
      <TacticalMapProvider sessionId="s" setLeftCollapsed={setLeftCollapsed}>
        <div />
      </TacticalMapProvider>,
    );

    await createMap('fight-1');
    expect(setLeftCollapsed).not.toHaveBeenCalled();
  });
});
