import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeDie } from '../diceShapes';
import { prefersReducedMotion, settleTrack } from '../PhysicsDiceBox';

vi.mock('howler', () => ({
  Howl: vi.fn(),
}));

describe('reduced-motion dice playback', () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  });

  afterEach(() => vi.restoreAllMocks());

  it('reads the reduce preference and settles directly on the last frame', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    expect(prefersReducedMotion()).toBe(true);

    const die = makeDie('d20', 0.95);
    const last = {
      p: [1.25, 0.95, -0.5] as [number, number, number],
      q: [0, 0, 0, 1] as [number, number, number, number],
    };
    const track = {
      die,
      frames: [
        {
          p: [0, 4, 0] as [number, number, number],
          q: [0, 0, 0, 1] as [number, number, number, number],
        },
        last,
      ],
      rotation: new THREE.Quaternion(),
      t: 0,
      done: false,
    };

    settleTrack(track);

    expect(track.done).toBe(true);
    expect(track.t).toBe(0);
    expect(track.die.mesh.position.toArray()).toEqual(last.p);
    expect(track.die.mesh.quaternion.toArray()).toEqual(last.q);
  });
});
