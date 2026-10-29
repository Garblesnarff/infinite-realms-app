import { render, screen } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rendererState = vi.hoisted(() => ({ scene: null as unknown }));

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three');
  class FakeWebGLRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: undefined, mapSize: { set: vi.fn() } };

    setPixelRatio(): void {}

    setSize(): void {}

    render(scene: unknown): void {
      rendererState.scene = scene;
    }

    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

vi.mock('howler', () => ({
  Howl: vi.fn(),
}));

const symmetryState = vi.hoisted(() => ({ calls: 0, throwOnCall: 1 }));

vi.mock('../diceShapes', async () => {
  const actual = await vi.importActual<typeof DiceShapes>('../diceShapes');
  return {
    ...actual,
    symmetry: (...args: Parameters<typeof actual.symmetry>) => {
      symmetryState.calls += 1;
      if (symmetryState.calls === symmetryState.throwOnCall) {
        throw new Error('no symmetry for test');
      }
      return actual.symmetry(...args);
    },
  };
});


import { expandRolls, PhysicsDiceBox, simulateTrayAsync } from '../PhysicsDiceBox';

import type * as DiceShapes from '../diceShapes';
import type { DiceRollResult } from '@/services/dice/DiceEngine';

import logger from '@/lib/logger';

describe('PhysicsDiceBox symmetry failure', () => {
  let media: MediaQueryList;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    media = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    symmetryState.calls = 0;
    symmetryState.throwOnCall = 1;
  });

  afterEach(() => {
    rendererState.scene = null;
    vi.restoreAllMocks();
  });

  it('shows the text result and logs when symmetry throws', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const result = {
      expression: '1d20',
      total: 13,
      rolls: [{ dice: 20, value: 13, sign: 1 as const, critical: false }],
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 13,
      timestamp: 5,
    } as DiceRollResult;
    const specs = expandRolls(result);
    const expected = await simulateTrayAsync(specs);
    const finalFrame = expected.frames.at(-1)?.[0];
    if (!finalFrame) throw new Error('simulation did not record a final frame');
    const frames = [[finalFrame], [finalFrame]];

    const view = render(
      <PhysicsDiceBox
        result={result}
        isRolling={false}
        showAnimation
        height={150}
        simulate={async () => ({ frames, flat: true })}
      />,
    );

    expect(
      await screen.findByText('Physics preview unavailable; the rules-engine result is 13.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Dice result 13: 13')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      '[dice] symmetry failed, showing text result',
      expect.any(Error),
    );
    view.unmount();
  });

  it('leaves no die mesh in the scene when symmetry throws on the second die', async () => {
    symmetryState.throwOnCall = 2;
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const sceneAddSpy = vi.spyOn(THREE.Scene.prototype, 'add');
    const result = {
      expression: '2d20',
      total: 20,
      rolls: [
        { dice: 20, value: 13, sign: 1 as const, critical: false },
        { dice: 20, value: 7, sign: 1 as const, critical: false },
      ],
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 13,
      timestamp: 5,
    } as DiceRollResult;
    const specs = expandRolls(result);
    const expected = await simulateTrayAsync(specs);
    const finalFrames = expected.frames.at(-1);
    if (!finalFrames || finalFrames.length !== 2) {
      throw new Error('simulation did not record a final frame per die');
    }
    const frames = [finalFrames, finalFrames];

    const view = render(
      <PhysicsDiceBox
        result={result}
        isRolling={false}
        showAnimation
        height={150}
        simulate={async () => ({ frames, flat: true })}
      />,
    );

    expect(
      await screen.findByText('Physics preview unavailable; the rules-engine result is 20.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Dice result 20: 13, 7')).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith(
      '[dice] symmetry failed, showing text result',
      expect.any(Error),
    );
    // The throw happened on the second die, after the first track built:
    // without the fix, the first die's mesh would already be in the scene.
    expect(symmetryState.calls).toBe(2);
    const added = sceneAddSpy.mock.calls.flat();
    const addedDice = added.filter(
      (object): object is THREE.Mesh =>
        object instanceof THREE.Mesh && !(object.geometry instanceof THREE.PlaneGeometry),
    );
    expect(addedDice).toHaveLength(0);
    view.unmount();
  });
});
