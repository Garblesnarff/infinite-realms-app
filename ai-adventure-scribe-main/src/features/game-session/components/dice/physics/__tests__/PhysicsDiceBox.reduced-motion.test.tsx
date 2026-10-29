import { render, screen, waitFor } from '@testing-library/react';
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

import { symmetry, topIndex } from '../diceShapes';
import { expandRolls, PhysicsDiceBox, simulateTrayAsync } from '../PhysicsDiceBox';

import type { DiceRollResult } from '@/services/dice/DiceEngine';

describe('PhysicsDiceBox reduced motion', () => {
  let change: ((event: MediaQueryListEvent) => void) | undefined;
  let media: MediaQueryList;

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    media = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
        change = listener as (event: MediaQueryListEvent) => void;
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
    vi.spyOn(window, 'matchMedia').mockReturnValue(media);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    rendererState.scene = null;
    change = undefined;
    vi.restoreAllMocks();
  });

  it('settles the mounted result directly, including a preference transition', async () => {
    const result = {
      expression: '1d20',
      total: 7,
      rolls: [{ dice: 20, value: 7, sign: 1 as const, critical: false }],
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 7,
      timestamp: 1,
    } as DiceRollResult;
    const specs = expandRolls(result);
    const expected = await simulateTrayAsync(specs);
    const finalFrame = expected.frames.at(-1)?.[0];
    if (!finalFrame) throw new Error('simulation did not record a final frame');
    const observedIndex = topIndex(specs[0].die, new THREE.Quaternion(...finalFrame.q)).idx;
    const expectedQuaternion = new THREE.Quaternion(...finalFrame.q).multiply(
      symmetry(specs[0].die, specs[0].die.faceIndexForValue(result.rolls[0].value), observedIndex),
    );

    const view = render(
      <PhysicsDiceBox result={result} isRolling={false} showAnimation height={150} />,
    );

    let die: THREE.Mesh | undefined;
    await waitFor(() => {
      const scene = rendererState.scene as THREE.Scene | null;
      die = scene?.children.find(
        (child): child is THREE.Mesh =>
          child instanceof THREE.Mesh && child.geometry.type !== 'PlaneGeometry',
      );
      expect(die).toBeDefined();
      expect(die?.position.toArray()).not.toEqual(finalFrame.p);
    });

    (media as unknown as { matches: boolean }).matches = true;
    change?.({ matches: true } as MediaQueryListEvent);
    await waitFor(() => {
      const scene = rendererState.scene as THREE.Scene | null;
      const die = scene?.children.find(
        (child): child is THREE.Mesh =>
          child instanceof THREE.Mesh && child.geometry.type !== 'PlaneGeometry',
      );
      expect(die?.position.toArray()).toEqual(finalFrame.p);
      expect(die?.quaternion.toArray()).toEqual(expectedQuaternion.toArray());
    });

    view.unmount();
  });

  it('shows the rules-engine result when the tray never settles flat', async () => {
    const result = {
      expression: '1d20',
      total: 13,
      rolls: [{ dice: 20, value: 13, sign: 1 as const, critical: false }],
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 13,
      timestamp: 2,
    } as DiceRollResult;

    const view = render(
      <PhysicsDiceBox
        result={result}
        isRolling={false}
        showAnimation
        simulate={async () => ({ frames: [], flat: false })}
      />,
    );

    expect(
      await screen.findByText('Physics preview unavailable; the rules-engine result is 13.'),
    ).toBeInTheDocument();
    view.unmount();
  });

  it('still announces the result when animation is off', async () => {
    const result = {
      expression: '1d20',
      total: 7,
      rolls: [{ dice: 20, value: 7, sign: 1 as const, critical: false }],
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 7,
      timestamp: 3,
    } as DiceRollResult;

    const view = render(
      <PhysicsDiceBox result={result} isRolling={false} showAnimation={false} height={150} />,
    );

    expect(view.container.querySelector('.sr-only')).not.toBeNull();
    expect(await screen.findByText('Dice result 7: 7')).toBeInTheDocument();
    view.unmount();
  });

  it('announces the result only after the dice stop', async () => {
    const result = {
      expression: '1d20',
      total: 7,
      rolls: [{ dice: 20, value: 7, sign: 1 as const, critical: false }],
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 7,
      timestamp: 4,
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

    expect(view.container.querySelector('.sr-only')?.textContent).toBe('');
    expect(await screen.findByText('Dice result 7: 7')).toBeInTheDocument();
    expect(screen.queryByText(/Physics preview unavailable/)).not.toBeInTheDocument();
    view.unmount();
  });
});
